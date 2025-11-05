# ITTRI Platform Frontend (Futuristic AI Theme)

Next.js 14 + TypeScript + Tailwind + shadcn-style components. Fully wired demo flows, themed with modern AI vibes.

## Quick Start
```bash
npm install
cp .env.local.template .env.local
npm run dev
```

## What’s inside
- App Router with auth + dashboard sections
- Zustand stores (user/ui) with theme toggling support
- React Query provider ready
- Recharts for charts
- Polished UI primitives (Button/Card/Input/Badge) exported
- Mock data to simulate backend responses (swap with your API when ready)

## Theme
CSS variables are centralized in `globals.css`. Toggle dark/system via the `theme` state in `useUIStore`.
