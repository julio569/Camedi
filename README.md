# Camedi


[![Live Demo](https://img.shields.io/badge/Live%20Demo-camedi.net-0ea5e9?style=for-the-badge&logo=vercel&logoColor=white)](https://camedi.net)
![Status](https://img.shields.io/badge/status-production-22c55e?style=for-the-badge)
![Built by](https://img.shields.io/badge/built%20by-1%20developer-6366f1?style=for-the-badge)

> **Medical duty scheduling platform for Argentine healthcare associations.**  
> Multi-tenant SPA with role-based access, real-time database and PWA support.

---

## The Problem

Medical associations in Argentina manage 24-hour duty rosters manually — spreadsheets, WhatsApp groups, phone calls. Doctors sign up for shifts without any automated conflict detection, quota enforcement or centralized record-keeping. Administrators spend hours reconciling availability each quarter.

## The Solution

Camedi is a web application that centralises the entire duty management cycle: associations publish shifts, doctors self-enroll through a validated queue, and administrators get a live dashboard. Every inscription goes through a server-side RPC that atomically checks quotas, overlaps and whitelists — no race conditions, no double bookings.

---

## Tech Stack

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white)

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES2022+), HTML5, CSS3 + Tailwind CDN |
| Auth | Supabase Auth (email confirmation flow) |
| Database | PostgreSQL via Supabase (Row Level Security on every table) |
| Realtime / Storage | Supabase |
| PWA | Service Worker + Web App Manifest |
| Hosting | Netlify (CDN, custom `_headers`) |

**No frameworks. No build step.** The entire frontend ships as static files.

---

## Features

### For Doctors
- Self-enrollment in published shifts with real-time slot availability
- Automatic conflict detection: overlap guard (±24 h), quarterly cap, monthly cap
- Cancellation window enforcement (minimum 48 h before shift start)
- Personal calendar with shift history and upcoming duties
- Onboarding flow: association selection, province, work locations

### For Association Admins
- Quarterly trimester management (open/close enrollment windows)
- Shift creation and whitelist control per shift
- Doctor approval / rejection workflow
- Enrollment cancellation on behalf of doctors
- Dashboard with shift fill rates and doctor activity

### For System Admins
- Full multi-tenant control across all associations
- Excel and PDF report export
- Manual inscription assignment
- User role management

### Platform
- **Multi-tenant**: each medical association has isolated data (RLS-enforced at DB level)
- **PWA**: installable on mobile and desktop, offline shell
- **Dark / Light mode**: persisted via `localStorage`
- **Responsive**: mobile-first layout

---

## Project Structure

camedi/
├── index.html              # Single-page app shell (all views inline)
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (cache-first shell, network-only for API)
├── _headers                # Netlify HTTP security headers
├── .env.example            # Environment variables template
│
├── css/
│   ├── tailwind.css        # Tailwind utility classes
│   └── styles.css          # Custom properties, animations, dark mode
│
├── js/
│   ├── supabase-client.js  # Supabase initialisation
│   ├── utils.js            # Shared helpers (dates, formatters, UI utilities)
│   ├── auth.js             # Auth flow: login, register, onboarding, password recovery
│   ├── medico.js           # Doctor panel (calendar, inscriptions, profile)
│   ├── admin.js            # System admin panel
│   ├── asociacion.js       # Association admin panel
│   ├── guardias.js         # Shift CRUD
│   ├── inscripciones.js    # Inscription management
│   ├── calendar.js         # Calendar rendering engine
│   └── reportes.js         # Report generation (Excel via SheetJS, lazy-loaded)
│
├── sql/                    # PostgreSQL migrations (run in order on Supabase)
│   ├── 01_schema.sql       # Core tables: profiles, sedes, trimestres, guardias, inscripciones
│   ├── 02_rls.sql          # Row Level Security policies
│   ├── 03_functions.sql    # Triggers, RPCs, views
│   ├── 05_medico_sedes.sql # Doctor ↔ location junction table
│   ├── 06_security_fixes.sql
│   ├── 07_guardia_pasada.sql
│   ├── 08_provincias.sql   # Argentine provinces reference table
│   ├── 09_security_fix.sql
│   ├── 10_security_fixes_v2.sql
│   ├── 11_asociaciones.sql # Multi-tenant layer: associations, tenant RLS, onboarding RPCs
│   ├── 12_cron_notificaciones.sql
│   ├── 13_grants.sql
│   ├── 14_fix_medicos_de_guardia.sql
│   ├── 15_whitelist_medicos.sql
│   └── 16_companeros_de_guardia.sql
│
└── supabase/
├── functions/          # Edge Functions (email notifications)
└── email-templates/    # Custom transactional email HTML



---
)


### About the Developer

Built and maintained by Julio Nacif — full-stack developer and founder of Camedi.

Designed, architected and shipped as a solo project: database schema, multi-tenant RLS policies, PWA configuration, UI/UX and production deployment.

[Image]
[Image]

Camedi is in active production. Feature requests and bug reports are welcome via Issues.



