# V2G Smart Charging System

An intelligent Vehicle-to-Grid (V2G) optimization platform with **Adaptive Multi-Objective Reinforcement Learning** for smart electric vehicle charging and discharging decisions.

## 🚀 Overview

This system enables electric vehicles to intelligently participate in grid services by:
- **Buying electricity** when prices are low
- **Selling back to grid** during peak demand (when prices are high)
- **Supporting grid stability** during stress events signaled by the power authority
- **Protecting battery health** through intelligent charging patterns

### Novel Contribution (Research Paper)

**"Adaptive Multi-Objective Reward Shaping for V2G Optimization"**

Unlike traditional approaches that use fixed optimization weights, our system **dynamically adjusts** the balance between:
- 💰 **Profit maximization** (buy low, sell high)
- ⚡ **Grid stability support** (respond to authority signals)
- 🔋 **Battery health preservation** (avoid deep discharge/overcharge)
- 👤 **User preferences** (respect quiet hours, min SOC, etc.)

The weights automatically shift based on real-time conditions (e.g., during grid emergencies, stability becomes priority).

## 📁 Project Structure

```
v2g-app/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/                  # Backend API endpoints
│   │   │   ├── device/           # Device CRUD + telemetry
│   │   │   ├── grid/             # Grid stress signals
│   │   │   ├── price/            # Electricity pricing
│   │   │   ├── contribution/     # Token rewards
│   │   │   └── decision/         # ML decision endpoint
│   │   ├── dashboard/            # Protected dashboard pages
│   │   ├── login/                # Authentication
│   │   └── page.tsx              # Landing page
│   │
│   ├── lib/                      # Core business logic
│   │   ├── services/
│   │   │   ├── price-service.ts      # TOU pricing with forecasts
│   │   │   ├── grid-service.ts       # Grid stress + adaptive weights
│   │   │   └── reward-shaper.ts      # NOVEL: Multi-objective rewards
│   │   ├── decision-engine.ts        # Rule-based fallback
│   │   ├── supabase.ts               # Database client
│   │   └── blockchain.ts             # Future: token contracts
│   │
│   ├── components/               # React components
│   ├── contexts/                 # Auth context
│   └── types/                    # TypeScript definitions
│       └── v2g.ts                # All V2G types
│
├── contracts/                    # Solidity smart contracts
│   ├── V2GToken.sol              # ERC-20 reward token
│   └── RewardDistributor.sol     # Token distribution
│
├── data/                         # Training datasets
│   ├── iex-prices/               # IEX DAM electricity prices
│   ├── ev-patterns/              # EV charging behavior
│   └── models/                   # Trained ML models
│
└── scripts/                      # Utility scripts
    └── analyze-data.ts           # Dataset analysis
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React, TailwindCSS, Framer Motion |
| Backend | Next.js API Routes (Vercel Edge Functions) |
| Database | Supabase (PostgreSQL + Auth) |
| ML | TensorFlow.js (DQN Agent) |
| Blockchain | Ethereum Sepolia, Solidity, ethers.js |
| Styling | Light Neumorphism design system |

## 🔌 API Endpoints

### Device Telemetry (ESP32)
```
POST /api/device/telemetry
```
ESP32 devices send BMS data (SOC, temperature, voltage) and receive charge/discharge commands.

### Grid Stress Signal
```
POST /api/grid/stress
Body: { "level": "normal" | "elevated" | "critical", "api_key": "..." }
```
Power authority sets grid stress level. All connected EVs adjust behavior accordingly.

### Electricity Prices
```
GET /api/price
```
Returns current price, 24-hour forecast, optimal buy/sell windows, and recommendations.

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- Supabase account (free tier)
- Git

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd v2g-app

# Install dependencies
npm install

# Copy environment variables
cp env.example .env

# Edit .env with your Supabase credentials
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Grid API (for municipality signals)
GRID_API_KEY=demo-grid-key

# Price Data Source
PRICE_DATA_SOURCE=mock  # Options: mock, dataset, iex_live

# ML Settings
ML_MODEL_ENABLED=true
```

## 📊 Training Data

The system uses historical data for training:

1. **IEX DAM Prices** - 5 years of Indian Energy Exchange Day-Ahead Market prices
2. **EV Charging Patterns** - Real charging session data with SOC, temperature, rates

Place datasets in:
- `data/iex-prices/DAM.xlsx`
- `data/ev-patterns/ev_charging_patterns.csv`

## 🔮 Future Roadmap

- [ ] DQN agent training pipeline
- [ ] ESP32 firmware for hardware integration
- [ ] Real IEX API integration
- [ ] Blockchain token rewards
- [ ] Multi-EV coordination experiments
- [ ] Research paper publication

## 📄 License

MIT License - see LICENSE file

## 👥 Contributors

Built with ❤️ for sustainable energy future
