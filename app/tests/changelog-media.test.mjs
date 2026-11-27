import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as model from '../content/changelog/model.mjs';

const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: id => id in mocks ? mocks[id] : require(id), ...globals });
  return exports;
}
const videoModule = load('../components/changelog/changelog-video.tsx');
const { ChangelogEntry } = load('../components/changelog/changelog-entry.tsx', {
  './changelog-video': videoModule,
  '@/content/changelog/model.mjs': model,
  'next/link': { default: ({ children, href }) => createElement('a', { href }, children) },
  'next/image': { default: 'img' },
});
const entry = (slug, film = true) => ({
  slug, date: '2026-11-26', status: 'published', title: slug, summary: 'An update.',
  ...(film ? { video: { src: '/videos/' + slug + '.mp4', poster: '/videos/' + slug + '.png', width: 1920, height: 1080, label: slug + ' film', caption: slug + ' caption' } } : {}),
});
function feed(groups) {
  const { default: Page } = load('../app/changelog/page.tsx', {
    '@/components/changelog/changelog-entry': { ChangelogEntry },
    '@/content/changelog': { getChangelogGroups: () => groups },
    '@/content/changelog/model.mjs': model,
    '@/lib/seo': { pageMetadata: value => value },
  });
  return renderToStaticMarkup(createElement(Page));
}

test('only the first film across release groups has a server-rendered poster', () => {
  const html = feed([
    { date: '2026-11-26', entries: [entry('text-only', false)] },
    { date: '2026-11-25', entries: [entry('first'), entry('second')] },
    { date: '2026-11-24', entries: [entry('third')] },
  ]);
  const videos = html.match(/<video\b[^>]*>/g);
  assert.equal(videos.length, 3);
  assert.match(videos[0], /poster="\/videos\/first.png"/);
  for (const video of videos.slice(1)) assert.doesNotMatch(video, /\bposter=/);
  for (const video of videos) {
    assert.match(video, /controls=""/);
    assert.match(video, /playsinline=""/i);
    assert.match(video, /preload="none"/);
    assert.match(video, /width="1920" height="1080"/);
    assert.match(video, /aria-label="[^"]+ film"/);
    assert.match(video, /aria-describedby="[^"]+-caption"/);
  }
  for (const slug of ['first', 'second', 'third']) {
    assert.ok(html.includes('src="/videos/' + slug + '.mp4"'));
    assert.ok(html.includes('<figcaption id="' + slug + '-caption">' + slug + ' caption</figcaption>'));
  }
  assert.doesNotMatch(feed([{ date: '2026-11-26', entries: [entry('no-film', false)] }]), /<video/);
  assert.doesNotMatch(feed([]), /<video/);
});

test('permalinks retain an eager poster and use that poster for social metadata', async () => {
  const release = entry('permalink');
  const route = load('../app/changelog/[slug]/page.tsx', {
    '@/components/changelog/changelog-entry': { ChangelogEntry },
    '@/content/changelog': { getChangelogEntry: () => release },
    '@/components/seo/json-ld': { JsonLd: () => null },
    '@/lib/seo': { pageMetadata: value => value, changelogJsonLd: value => value },
  });
  const props = { params: Promise.resolve({ slug: release.slug }) };
  assert.match(renderToStaticMarkup(await route.default(props)), /<video[^>]+poster="\/videos\/permalink.png"/);
  assert.equal((await route.generateMetadata(props)).image.url, release.video.poster);
});

function mountVideo(deferPoster, Observer) {
  const element = {}, effects = [];
  const { ChangelogVideo } = load('../components/changelog/changelog-video.tsx', {
    react: { useRef: () => ({ current: element }), useEffect: effect => effects.push(effect) },
  }, { IntersectionObserver: Observer });
  const tree = ChangelogVideo({ poster: '/videos/later.png', deferPoster });
  const cleanup = effects[0]();
  return { tree, element, cleanup };
}

test('later posters attach near the viewport and observers disconnect after loading and on unmount', () => {
  const observers = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnects = 0; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnects++; }
  }
  const mounted = mountVideo(true, Observer);
  assert.equal(mounted.tree.props.poster, undefined);
  assert.equal(mounted.element.poster, undefined);
  assert.equal(observers[0].options.rootMargin, '100% 0px');
  assert.equal(observers[0].target, mounted.element);
  observers[0].callback([{ isIntersecting: false }]);
  assert.equal(mounted.element.poster, undefined);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(mounted.element.poster, '/videos/later.png');
  assert.equal(observers[0].disconnects, 1);
  mounted.cleanup();
  assert.equal(observers[0].disconnects, 2);
  mountVideo(true, Observer).cleanup();
  assert.equal(observers[1].disconnects, 1, 'unmount before intersection also disconnects');
  const eager = mountVideo(false, Observer);
  assert.equal(eager.tree.props.poster, '/videos/later.png');
  assert.equal(observers.length, 2, 'eager films do not create observers');
});

test('later posters attach immediately when IntersectionObserver is unavailable', () => {
  const mounted = mountVideo(true, undefined);
  assert.equal(mounted.tree.props.poster, undefined, 'server and initial client markup agree');
  assert.equal(mounted.element.poster, '/videos/later.png');
});
