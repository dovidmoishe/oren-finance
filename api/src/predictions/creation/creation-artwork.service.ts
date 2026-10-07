import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MarketService } from '../../market/market.service';
import type {
  CreationTerms,
  PredictionCreationDraft,
} from '../../../types/prediction-creation';
import { publicHttps } from './creation.validation';
const xml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function publicAddress(ip: string) {
  if (ip.includes(':')) return false; // Canonical images must resolve to public IPv4; otherwise use fallback.
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b, c] = parts;
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    a !== 169 &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 192 && b === 0 && c === 2) &&
    !(a === 203 && b === 0 && c === 113)
  );
}
export async function canonicalLogo(url: string): Promise<Buffer> {
  if (!publicHttps(url)) throw new Error('Unsafe logo');
  const parsed = new URL(url),
    address = await lookup(parsed.hostname, { family: 4 });
  if (!publicAddress(address.address)) throw new Error('Unsafe logo address');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const req = request(
      parsed,
      {
        method: 'GET',
        timeout: 8000,
        lookup: (_host, _opts, callback) => callback(null, address.address, 4),
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          !/^image\/(png|jpeg|webp)(;|$)/.test(
            String(res.headers['content-type']),
          )
        ) {
          res.resume();
          reject(new Error('Unsupported logo'));
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy(new Error('Logo too large'));
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(parts)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Logo timed out')));
    req.on('error', reject);
    req.end();
  });
  return sharp(bytes, { limitInputPixels: 10_000_000 })
    .resize(240, 240, { fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();
}
@Injectable()
export class CreationArtworkService {
  constructor(private readonly market: MarketService) {}
  async render(
    terms: CreationTerms,
  ): Promise<PredictionCreationDraft['artwork']> {
    const warnings: string[] = [];
    const logos = await Promise.all(
      terms.assetIds.slice(0, 2).map(async (id) => {
        try {
          const stock = await this.market.getStock(id);
          return {
            ticker: stock.ticker,
            bytes: stock.logo ? await canonicalLogo(stock.logo) : null,
          };
        } catch {
          warnings.push('Canonical logo unavailable; neutral artwork used.');
          return { ticker: 'Asset', bytes: null };
        }
      }),
    );
    const symbols = logos.length
      ? logos.map((l) => l.ticker)
      : [terms.template === 'macro' ? 'Economy' : 'Crypto'];
    const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#f7f6f2"/><circle cx="512" cy="470" r="340" fill="#e6f0e8"/><text x="64" y="100" font-size="40" font-family="sans-serif" fill="#242824">Oren · Predictions</text>${symbols.map((s, i) => `<text x="${symbols.length === 2 ? (i ? 730 : 290) : 512}" y="${logos[i]?.bytes ? 670 : 510}" text-anchor="middle" font-size="${symbols.length === 2 ? 58 : 82}" font-family="sans-serif" fill="#242824">${xml(s.slice(0, 18))}</text>`).join('')}${symbols.length === 2 ? '<text x="512" y="490" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#667266">VS</text>' : ''}<text x="64" y="950" font-size="30" font-family="sans-serif" fill="#667266">Powered by Panta</text></svg>`;
    const png = await sharp(Buffer.from(svg))
      .composite(
        logos.flatMap((l, i) =>
          l.bytes
            ? [
                {
                  input: l.bytes,
                  top: 300,
                  left: symbols.length === 2 ? (i ? 610 : 170) : 392,
                },
              ]
            : [],
        ),
      )
      .png()
      .toBuffer();
    return {
      contentHash: createHash('sha256').update(png).digest('hex'),
      previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      imageUrl: null,
      warnings: [...new Set(warnings)],
    };
  }
}
