# SMT Verification System

A comprehensive Surface Mount Technology (SMT) feeder scanning and verification system with BOM management, reporting, and analytics capabilities.

## 📁 Project Structure

```
SMTVerification/
├── artifacts/                  # Source code (TypeScript/React)
│   ├── api-server/            # Express.js backend API
│   ├── feeder-scanner/        # React frontend application
│   └── mockup-sandbox/        # UI mockup components
│
├── lib/                        # Shared libraries
│   └── db/                     # Database schema and migrations (Drizzle ORM)
│
├── docs/                       # Complete documentation
│   ├── guides/                # User guides and API references
│   ├── setup/                 # Deployment and setup guides
│   ├── features/
│   │   ├── bom/              # BOM feature documentation
│   │   ├── scanning/         # Feeder scanning features
│   │   └── reports/          # Analytics and reporting
│   ├── reports/              # Phase reports and project summaries
│   ├── samples/              # Sample data, BOMs, and SQL scripts
│   └── INDEX.md              # Documentation index
│
├── scripts/                    # Build and deployment scripts
├── logs/                       # Application logs
├── attached_assets/            # External assets and resources
│
├── package.json               # Root package configuration
├── pnpm-workspace.yaml        # Monorepo workspace config
├── pnpm-lock.yaml            # Dependency lock file
├── tsconfig.base.json        # TypeScript base configuration
├── QUICK_START.md            # Quick start guide
├── SECURITY.md               # Security policies
└── README.md                 # This file
```

## 🚀 Quick Start

1. **Setup**: See [QUICK_START.md](QUICK_START.md) for initial setup
2. **Deployment**: Check [docs/setup/DEPLOYMENT_SETUP.md](docs/setup/DEPLOYMENT_SETUP.md)
3. **API Reference**: See [docs/guides/API_REFERENCE.md](docs/guides/API_REFERENCE.md)
4. **BOM Management**: View [docs/features/bom/](docs/features/bom/) for BOM guides

## Next.js Feeder Verification App

The root workspace now includes a separate Next.js implementation at [feeder-verification/](feeder-verification/).

```bash
cd feeder-verification
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm prisma:seed
pnpm dev
```

## 📚 Documentation

- **Setup Guides**: [docs/setup/](docs/setup/)
- **User Guides**: [docs/guides/](docs/guides/)
- **Feature Documentation**: [docs/features/](docs/features/)
- **Project Reports**: [docs/reports/](docs/reports/)
- **Sample Data**: [docs/samples/](docs/samples/)

## 🔐 Security

For security policies and guidelines, see [SECURITY.md](SECURITY.md)

## 📋 Key Features

- **Feeder Verification**: Automated feeder scanning with BOM validation
- **BOM Management**: 16-field BOM support with import/export capabilities
- **Analytics**: Real-time reporting and FPY (First Pass Yield) tracking
- **Multi-Mode Operation**: AUTO and MANUAL verification modes
- **Dual Identifier Support**: Accept PART# or MPN for feeder verification

## 🛠️ Technology Stack

- **Backend**: Express.js, TypeScript, PostgreSQL, Drizzle ORM
- **Frontend**: React, Vite, TailwindCSS
- **Database**: PostgreSQL with migrations
- **Monorepo**: pnpm workspaces

## 📝 License & Attribution

See [SECURITY.md](SECURITY.md) for additional information.

---

For comprehensive documentation, visit [docs/INDEX.md](docs/INDEX.md)
