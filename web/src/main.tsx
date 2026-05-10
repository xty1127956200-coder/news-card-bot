import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, CalendarDays, Maximize2, RefreshCw, X } from "lucide-react";
import "./styles.css";

type CardRun = {
  id: string;
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  cards: CardRecord[];
  sources: string[];
};

type CardRecord = {
  runId: string;
  fileName: string;
  title: string;
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  category: string;
  page: string;
  sources: string[];
  url?: string;
};

type CardsJson = {
  updatedAt: string;
  cards: CardRecord[];
};

function App() {
  const [cardsJson, setCardsJson] = useState<CardsJson | null>(null);
  const [selectedDate, setSelectedDate] = useState("all");
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadManifest() {
    setLoading(true);
    try {
      const response = await fetch(assetPath("cards/cards.json"), { cache: "no-store" });
      if (!response.ok) throw new Error("cards.json not found");
      setCardsJson(await response.json());
    } catch {
      setCardsJson({ updatedAt: new Date().toISOString(), cards: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadManifest();
  }, []);

  const allRuns = useMemo(() => groupCards(cardsJson?.cards ?? []), [cardsJson]);

  const dates = useMemo(() => {
    const values = new Set(allRuns.map((run) => toDateKey(run.generatedAt)));
    return [...values];
  }, [allRuns]);

  const runs = useMemo(() => {
    return selectedDate === "all" ? allRuns : allRuns.filter((run) => toDateKey(run.generatedAt) === selectedDate);
  }, [allRuns, selectedDate]);

  return (
    <main>
      <header className="appHeader">
        <div>
          <p>NEWS CARD BOT</p>
          <h1>过去2小时新闻卡片</h1>
        </div>
        <button aria-label="刷新" onClick={loadManifest}>
          <RefreshCw size={22} />
        </button>
      </header>

      <section className="toolbar">
        <label>
          <CalendarDays size={18} />
          <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
            <option value="all">全部日期</option>
            {dates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </label>
        <button aria-label="预留通知">
          <Bell size={18} />
          <span>通知预留</span>
        </button>
      </section>

      {loading ? <p className="empty">正在读取历史卡片...</p> : null}
      {!loading && runs.length === 0 ? <p className="empty">还没有历史卡片。先运行 npm run generate:mock 生成测试数据。</p> : null}

      <section className="runs">
        {runs.map((run) => (
          <article className="run" key={run.id}>
            <div className="runMeta">
              <div>
                <h2>{formatDateTime(run.generatedAt)}</h2>
                <p>{formatDateTime(run.rangeStart)} - {formatDateTime(run.rangeEnd)}</p>
              </div>
              <span>{run.cards.length} 张</span>
            </div>
            <div className="cards">
              {run.cards.map((card, index) => (
                <button className="thumb" key={card.fileName} onClick={() => setActiveImage(card.url ?? card.fileName)} aria-label={`查看第 ${index + 1} 张`}>
                  <img src={toPublicImageUrl(card.url ?? card.fileName)} alt={card.title} loading="lazy" />
                  <span><Maximize2 size={16} /> {card.page}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      {activeImage ? (
        <div className="lightbox" role="dialog" aria-modal="true">
          <button aria-label="关闭" onClick={() => setActiveImage(null)}>
            <X size={28} />
          </button>
          <img src={toPublicImageUrl(activeImage)} alt="高清新闻卡片" />
        </div>
      ) : null}
    </main>
  );
}

function toPublicImageUrl(value: string): string {
  if (value.startsWith("http")) return value;
  if (value.startsWith("cards/")) return assetPath(value);
  return assetPath(`cards/${value.replace(/\\/g, "/").split("/").pop()}`);
}

function assetPath(value: string): string {
  const base = import.meta.env.BASE_URL || "./";
  return `${base.replace(/\/?$/, "/")}${value.replace(/^\//, "")}`;
}

function groupCards(cards: CardRecord[]): CardRun[] {
  const grouped = new Map<string, CardRecord[]>();
  for (const card of cards) {
    grouped.set(card.runId, [...(grouped.get(card.runId) ?? []), card]);
  }

  return [...grouped.entries()].map(([id, runCards]) => {
    const sorted = runCards.sort((a, b) => Number(a.page.split("/")[0]) - Number(b.page.split("/")[0]));
    const first = sorted[0];
    return {
      id,
      generatedAt: first.generatedAt,
      rangeStart: first.rangeStart,
      rangeEnd: first.rangeEnd,
      cards: sorted,
      sources: first.sources
    };
  });
}

function toDateKey(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

createRoot(document.getElementById("root")!).render(<App />);
