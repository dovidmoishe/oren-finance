export interface NewsFeedStock {
  assetId: string;
  ticker: string;
  name: string;
}

export interface NewsStory {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  stocks: NewsFeedStock[];
}

export interface NewsFeed {
  items: NewsStory[];
  selection: "agent" | "latest";
  state: "ready" | "no_holdings" | "no_news";
  stocks: NewsFeedStock[];
  totalHoldings: number;
  partial: boolean;
  generatedAt: string;
}
