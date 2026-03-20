# MarketPulse — Financial Intelligence Dashboard

![MarketPulse Dashboard Mockup](ui.html) <!-- Note: This is a placeholder reference to the UI file -->

**MarketPulse** is a professional-grade quantitative trading dashboard designed for real-time market monitoring, regime detection, and AI-assisted trade ideation. It combines high-fidelity data visualization with automated technical analysis to provide a comprehensive view of global markets.

## 🚀 Features

-   **Multi-Asset Live Tracking**: Real-time price action for Equities (S&P 500, NASDAQ, Dow Jones), Crypto (BTC, ETH, SOL), and Commodities (Gold, WTI Crude).
-   **Automated Regime Detection**: Dynamic classification of market environments (Bull, Bear, Neutral, Transition) using a multi-factor model (ADX, Moving Averages, RSI).
-   **Advanced Technical Library**: In-house implementation of core indicators:
    -   Relative Strength Index (RSI)
    -   MACD (Moving Average Convergence Divergence)
    -   Bollinger Bands & %B
    -   Average True Range (ATR) & ADX
    -   Stochastic Oscillators
-   **AI Analyst Integration**: Configurable connection to Anthropic's Claude for generating regime-aligned trade ideas and market commentary.
-   **Institutional UI**: A high-density, dark-mode terminal featuring:
    -   Real-time scrolling ticker
    -   Breaking news banner
    -   Interactive multi-panel charts via Chart.js
    -   Account metrics and risk management HUD

## 🛠 Tech Stack

-   **Frontend**: Pure HTML5, CSS3 (Vanilla), and JavaScript (ES6+).
-   **Visualization**: [Chart.js](https://www.chartjs.org/) for high-performance rendering.
-   **Data Sources**: Alpaca Markets API (Direct), Yahoo Finance (via Proxy), and CoinGecko.
-   **Server**: Python-native static file server.

## 🏁 Getting Started

### Prerequisites

-   **Python 3.x**: Required to run the local development server (handles CORS).
-   **API Keys** (Optional for full functionality):
    -   Alpaca Markets API Key (for live/paper trading)
    -   Anthropic API Key (for AI Analyst features)

### Installation & Launch

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/QuantDashboard.git
    cd QuantDashboard
    ```
2.  Launch the dashboard:
    ```bash
    bash start.sh
    ```
    This script will automatically start a local server at `http://localhost:8080` and open it in your default browser.

3.  **Configuration**:
    Open the configuration panel (gear icon) within the dashboard to enter your API keys. These are stored locally in your browser's `localStorage` and are never sent to external servers other than the direct API endpoints.

## 🛡 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

MarketPulse is for educational and informational purposes only. Trading involves significant risk. Always perform your own due diligence before executing trades.
