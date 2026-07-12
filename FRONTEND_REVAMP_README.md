# HireLoop Frontend Revamp

## What Changed

This pass turns the frontend into a polished app experience:

- Public landing page with HireLoop positioning, Google sign-in CTA, how-it-works steps, and feature cards.
- Authenticated app shell with persistent navigation between Dashboard and Settings.
- First-time setup prompt for missing Q&A profile or resume data, with quick links into Settings.
- Dashboard with lightweight stats, LinkedIn/external run controls, filters, application list, and exact-answer detail view.
- Settings split into Q&A Profile, Resume Library, Credentials, and Preferences.
- Resume delete support added through a small backend endpoint.

Core automation behavior was not changed. The LinkedIn 15/day cap remains backend-enforced, and non-LinkedIn skip-and-flag behavior remains intact.

## Design System

The visual language is Apple-inspired restraint: neutral surfaces, generous spacing, precise type, and one sparse accent color.

- Font: `Inter`, with Apple system font fallbacks (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`).
- Neutral palette:
  - Light page: `#f5f5f7`
  - Light surface: `#ffffff` / translucent white
  - Dark mode page: `#000000`
  - Dark mode surface: `#1c1c1e`
  - Primary text: `#1d1d1f` in light mode, `#f5f5f7` in dark mode
  - Muted text: `#6e6e73`
- Single accent color: Apple-style blue `#0071e3`, used for primary actions, focus states, and selected highlights only.
- Radius tokens: `14px` for panels/cards, `10px` for inputs, pill radius for buttons and segmented controls.
- Shadows: quiet neutral shadows only, with no luminous decoration.
- Blur/translucency: subtle frosted surfaces on nav and panels with `backdrop-filter: blur(18px) saturate(180%)`.
- Motion: restrained fade/slide transitions, gentle hover lift, simple pulse skeletons, and a minimal spinner.

The shared tokens live in `apps/frontend/src/styles.css`.

## Backend Endpoint Added

`DELETE /api/resumes/:id`

Deletes a resume owned by the authenticated user, removes the stored file, and if the deleted resume was selected, promotes the newest remaining resume as the default.

## Environment Notes

For the deployed frontend:

```bash
VITE_API_BASE_URL=https://hireloop-ggab.onrender.com
```

For the deployed backend:

```bash
FRONTEND_ORIGIN=https://hireloop-henna.vercel.app
GOOGLE_REDIRECT_URI=https://hireloop-ggab.onrender.com/api/auth/google/callback
```

The Google OAuth client must include:

- Authorized JavaScript origin: `https://hireloop-henna.vercel.app`
- Authorized redirect URI: `https://hireloop-ggab.onrender.com/api/auth/google/callback`

## Verification

Run from the repo root:

```bash
npm run lint --prefix apps/frontend
npm run test --prefix apps/frontend
npm run build --prefix apps/frontend
npm run lint --prefix apps/backend
npm run test --prefix apps/backend
npm run build --prefix apps/backend
```

All checks passed during this revamp.

## Known Limitations

- Preferences are visible as product defaults, but editable preference persistence needs a dedicated backend preferences model before users can save custom values.
- The setup prompt is intentionally lightweight and skippable; a deeper guided wizard can be added later.
- Gmail outcome tracking is shown in Settings because Phase 6 exists, but it remains optional and separate from the core setup path.
