# AudioKing — Premium Pro Audio & Musical Instruments Platform

A complete, production-grade Indian pro audio & musical instrument e-commerce platform and dedicated administration suite. Engineered for high performance, zero-friction browsing, ACID-compliant SQLite data persistence, real-time Gmail SMTP OTP verification, Google OAuth 2.0, and dynamic blanket offer promotions.

---

## 🌟 Key Features

### 🛒 Customer Storefront
- **Extensive Catalog**: 280+ industry-grade pro audio items (microphones, studio monitors, audio interfaces, mixers, headphones, and guitar pedals & effects).
- **Instant Search & Deep Filtering**: Real-time multi-facet filtering by category, brand, stock availability, and price range.
- **Detailed Product Pages**: Multi-angle gallery, embedded YouTube/video demos, technical specs matrix, warranty verification, related products, and stock status.
- **Cart & Slide-Over Drawer**: Interactive quantity adjustments, real-time subtotal calculations, and free pan-India shipping computation.
- **Multi-Step Checkout & Orders**: Address manager, payment simulation (UPI, Cards, Net Banking, COD), and order confirmation receipts with unique `AK-` order tracking IDs.
- **Account & Address Center**: Customer profile management, shipping address registry, and order history tracking.

### 🔐 Authentication & Security
- **Dual-Flow Gmail SMTP OTP Verification**:
  - **New User Registration**: 6-digit cryptographic OTP dispatched to user's Gmail before account activation.
  - **Forgot Password**: 6-digit OTP email verification yielding a single-use 15-minute password reset token.
- **Google OAuth 2.0 / GIS**: Google Sign-In with dynamic client configuration.
- **Session Security**: HTTP-only signed cookies + bearer token support, bcrypt salted password hashing, and brute-force rate-limiting.

### 🎛️ Master Admin Control Center (`/#admin` or `/admin`)
- **Store Dashboard**: Live KPIs (revenue, total orders, active customer accounts, low-stock alerts with 1-click restock).
- **Catalog Management**: Full CRUD operations for products, bulk variant stock synchronization, image upload dropzone, and specs JSON editor.
- **Blanket Offers & Storewide Discounts**:
  - Schedule blanket discounts across an entire category or a specific product.
  - **Searchable Product Picker**: Dedicated search bar and a scrollable dropdown displaying exactly 10 visible products initially (with smooth scrolling for 280+ items) and 1-click selection badges.
  - Automatic storefront price adjustment and discount badging.
- **Cart Coupons**: Percentage or flat discounts with minimum spend rules and validity windows.
- **Customer & Order Management**: Real-time status updates (Processing, Shipped, Delivered, Cancelled) and customer purchase history inspector.
- **View Persistence on Refresh**: Deep hash routing (`#admin/offers`, `#admin/products`, `#admin/coupons`, `#admin/orders`) preserves your active tab across page refreshes with zero flash of the main dashboard.

### 🎨 Typography & Design System
- **Pricing Digits**: Roboto Medium (`font-weight: 500`) with neutral grey MRP (`#94A3B8`) and vibrant red strikethrough line (`#EF4444`).
- **Brand Palette**: Clean light aesthetic, deep studio navy (`#0B315F`), and signature AudioKing orange (`#F27021`).
- **Early Route Preloader**: Inlines critical layout CSS in `<head>` to eliminate any flash of the home page on deep-link refreshes.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (Node v20+ recommended with built-in `node:sqlite`)
- **npm**: v9.0.0 or higher

### 2. Clone the Repository
```bash
git clone https://github.com/AudioKing30/Audio-King-Official.git
cd Audio-King-Official
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` and provide your configuration:
```env
PORT=3000
NODE_ENV=development
DATABASE_PATH=./server/data/audioking.db
SESSION_SECRET=audioking_dev_session_secret_123456789_abcdef

# Live Gmail SMTP (For registration & password reset OTP emails)
GMAIL_USER=audioking30@gmail.com
GMAIL_APP_PASSWORD=shojvtbwiaagjben
EMAIL_FROM="AudioKing <audioking30@gmail.com>"
EMAIL_FROM_NAME="AudioKing"

# Google Cloud OAuth 2.0
GOOGLE_CLIENT_ID=your_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 5. Start the Server
```bash
npm start
```
The server will initialize the SQLite database, seed the admin account and product catalog, and listen at:
```
http://localhost:3000
```

---

## 🔑 Default Administrator Credentials

On initial startup, `server/seedAdmin.js` automatically seeds the master administrator account:
- **Email**: `audioking30@gmail.com`
- **Password**: `Musix@Admin2026!`
- **Admin Portal URL**: `http://localhost:3000/#admin` (or `http://localhost:3000/admin`)

---

## 📁 Repository Structure

```
├── admin/                     # Dedicated Admin Control Panel
│   ├── css/admin.css          # Admin portal stylesheet (desktop & mobile responsive)
│   ├── js/admin.js            # Admin controller, view routing, APIs, blanket offer picker
│   ├── index.html             # Standalone admin layout template
│   └── login.html             # Admin authentication portal
├── assets/                    # Static brand imagery & SVG assets
│   ├── images/                # Product photos, hero slides, and brand logos
│   └── icons/icons.js         # Vector icon dictionary
├── css/                       # Modular storefront stylesheets
│   ├── variables.css          # Design tokens (colors, Roboto 500 pricing, shadows)
│   ├── catalog.css            # Store catalog grid, filters, and mobile drawer
│   ├── product.css            # Product detail view & specs table
│   ├── checkout-page.css      # Checkout flow & order summary
│   ├── drawer.css             # Slide-over cart drawer
│   └── header.css             # Sticky navigation, search bar, and dropdowns
├── js/                        # Modular frontend client architecture
│   ├── app.js                 # SPA hash router & view orchestrator
│   ├── bundle.js              # Production IIFE build
│   └── components/            # Auth, Cart, Checkout, Account Settings, Store modules
├── server/                    # Node.js backend architecture
│   ├── index.js               # Express server entry point
│   ├── db.js                  # SQLite database engine schema & migrations
│   ├── email.js               # Gmail SMTP & Nodemailer transactional OTP dispatcher
│   ├── security.js            # Cryptographic token hashing & password reset utils
│   ├── seedAdmin.js           # Auto-seeder for admin credentials and initial catalog
│   ├── middleware/            # Auth guards & admin authorization middleware
│   └── routes/                # REST API route handlers (auth, products, offers, orders)
├── .env.example               # Environment variables template
├── .gitignore                 # Security exclusions (.env, local SQLite db, test profiles)
├── index.html                 # Main storefront single-page application
└── package.json               # NPM scripts and dependencies
```

---

## 🛠️ Build & Development Commands

```bash
# Start production server
npm start

# Start server in watch mode (auto-restarts on code change)
npm run dev

# Rebuild frontend bundle (ESBuild IIFE)
npm run build
```

---

## 📄 License

ISC License &copy; 2026 AudioKing India. All rights reserved. Professional Musical Instruments & Studio Gear.
