// Plain-language definitions for the jargon used across the dashboard.
// `short` is for inline tooltips (InfoTip); `long` is for the guide's glossary
// section. Kept consistent with CHIP_META in BoomScorePanel.jsx and WEIGHTS in
// backend/app/sources/boom_score.py — change them together.

export const GLOSSARY = {
  boom_score: {
    label: "Boom Score",
    short: "One composite number from −90 to +100 that sums every other signal on the dashboard.",
    long: "A single, explainable score that adds up all the bullish (positive) and bearish (negative) signals for a ticker. Range is roughly −90 to +100. Higher means more independent signals are pointing up right now. It is evidence to investigate, not a prediction — every component that fired is shown so you can see why.",
  },
  golden_cross: {
    label: "Golden cross",
    short: "The 50-day average price crossing above the 200-day average — a classic medium-term uptrend signal.",
    long: "When a stock's 50-day moving average rises above its 200-day moving average. It signals that recent momentum has overtaken the longer trend, which historically marks the start of medium-term up-moves. Adds +20 to the Boom Score.",
  },
  death_cross: {
    label: "Death cross",
    short: "The 50-day average dropping below the 200-day average — a medium-term downtrend signal.",
    long: "The opposite of a golden cross: the 50-day moving average falls below the 200-day moving average, suggesting a medium-term downtrend. Subtracts 20 from the Boom Score.",
  },
  rsi: {
    label: "RSI (Relative Strength Index)",
    short: "A 0–100 momentum gauge. Below ~30 is oversold; above ~70 is overbought.",
    long: "The Relative Strength Index measures how fast and far price has moved on a 0–100 scale. A reading of 30–50 is treated as an oversold-recovery zone (adds +10); above 70 is overbought and pullback-prone (subtracts 10).",
  },
  macd: {
    label: "MACD crossover",
    short: "A momentum trigger — the MACD line crossing above its signal line.",
    long: "MACD (Moving Average Convergence Divergence) compares two moving averages to track momentum. When the MACD line crosses above its signal line it flags a fresh shift to upward momentum. Adds +10 to the Boom Score.",
  },
  relative_volume: {
    label: "Relative volume",
    short: "Today's trading volume versus its average. A rising price on >1.5× volume shows real participation.",
    long: "How heavily a stock is trading compared with its typical day. A price rising on more than 1.5× average volume means the move is backed by real buying interest rather than a thin drift. Adds +10 (\"volume confirmed\").",
  },
  near_52w_high: {
    label: "Near 52-week high",
    short: "Price within ~3% of its highest level in a year — breakout territory.",
    long: "When the current price sits within about 3% of its highest point over the past 52 weeks. Stocks breaking to new highs often keep running as resistance clears. Adds +10 to the Boom Score.",
  },
  short_interest: {
    label: "Short interest",
    short: "The share of a stock's float that traders have bet against by selling borrowed shares.",
    long: "The percentage of a company's freely tradable shares that have been sold short (a bet the price will fall). Very high short interest can fuel sharp upward moves if those traders are forced to buy back — see short squeeze.",
  },
  short_squeeze: {
    label: "Short squeeze",
    short: "When a heavily shorted stock rises, forcing short sellers to buy back and push it higher.",
    long: "If a stock with high short interest starts rising, short sellers may be forced to buy shares to limit losses, which pushes the price up further in a feedback loop. The dashboard flags squeeze potential when short float is high; adds +10.",
  },
  insider_cluster: {
    label: "Insider cluster trade",
    short: "Two or more company officers/directors buying (or selling) their own stock in a short window.",
    long: "Corporate insiders (executives, directors) must disclose trades on SEC Form 4. Several of them buying around the same time is a strong conviction signal (adds +20); several selling is a warning (subtracts 20).",
  },
  congress_trade: {
    label: "Congressional trade",
    short: "A stock trade disclosed by a member of Congress, weighted by dollar size and recency.",
    long: "Members of Congress disclose their stock transactions. A purchase adds up to +15 (scaled by the reported dollar range and how recent it is); a sale subtracts 15. Treated as a slower, longer-horizon signal.",
  },
  analyst_rating: {
    label: "Analyst rating change",
    short: "Wall Street analysts upgrading or downgrading a stock's recommendation.",
    long: "Professional analysts publish buy/hold/sell ratings. A recent upgrade or initiation adds +15; a cluster of two or more downgrades subtracts 15. The dashboard also flags when earnings are within 7 days (extra event risk).",
  },
  fear_greed: {
    label: "Fear & Greed Index",
    short: "CNN's 0–100 market-mood gauge. Extreme fear (<25) often marks contrarian entry points.",
    long: "A composite of market indicators on a 0–100 scale where low is fear and high is greed. Extreme fear (below 25) historically marks good contrarian entry points and adds +10; extreme greed (above 78) signals froth and subtracts 10.",
  },
  yield_curve: {
    label: "Yield curve (un-inversion)",
    short: "When short-term Treasury yields fall back below long-term yields after being inverted.",
    long: "Normally longer-term bonds pay more than short-term ones. When that flips (an inversion) it has historically preceded recessions; the curve returning to normal (un-inverting) has historically preceded recoveries 6–18 months out. A recent un-inversion adds +15.",
  },
  seasonality: {
    label: "Seasonality",
    short: "A stock's historical tendency to rise or fall during this specific time of year.",
    long: "Some stocks show a repeatable edge in particular calendar windows. The dashboard flags a seasonal tailwind when a ticker has averaged at least +2% with a 60%+ win rate over the past ~10 years for the coming week. Adds +10.",
  },
  contracts_catalyst: {
    label: "Federal contract catalyst",
    short: "A large new U.S. government award (>$100M) — concrete, booked future revenue.",
    long: "Major federal contracts are real, disclosed future revenue rather than speculation. A new award over $100M in the last 30 days for a watchlist company adds +10 to the Boom Score.",
  },
};

export default GLOSSARY;
