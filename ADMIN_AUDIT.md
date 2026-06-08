# Admin Panel Audit — Worldwide Trading

**Date:** 2026-05-18
**File:** `admin.html` (3,460 lines, ~229 KB single file)
**Database:** Supabase project `tjeucyzkjrirvvmxklmu`

---

## Scored Rubric

| # | Dimension | Score | Summary |
|---|-----------|-------|---------|
| 1 | Database as gatekeeper | 3/5 | RLS enabled everywhere, but policy roles could not be verified via SQL; several columns lack NOT NULL; price/amount stored as `text` |
| 2 | Validation | 2/5 | Almost all validation is client-side only; Postgres has one CHECK constraint and almost no NOT NULL on business fields |
| 3 | Inventory & financials CRUD | 4/5 | Full CRUD with bulk ops, partial-sell, lot management. All data loaded into memory (no DB pagination) |
| 4 | UX states | 2/5 | Toasts for success/error; many async paths silently swallow errors; no loading spinners on save buttons beyond two functions |
| 5 | Architecture & duplication | 2/5 | 3,460-line monolith with ~13 modals, 4 near-identical drag-drop upload blocks, repeated CRUD patterns |
| 6 | Mobile usability | 3/5 | Sidebar collapses, grids reflow; but tables still require horizontal scroll, modals untested for small screens |
| 7 | Performance | 2/5 | Every table fetched with `select=*`, no DB-level pagination, N+1 PATCH loops in bulk ops, analytics loads all page_views ever |
| 8 | Design quality & visual craft | 4/5 | Strong dark-mode design system with CSS variables, consistent type scale, good visual hierarchy. Light mode also supported. Minor inconsistencies in spacing |

---

## 1. Database as Gatekeeper (3/5)

### RLS status
All 9 public tables have `rls_enabled: true` per the schema introspection. However, I was unable to execute SQL to inspect the actual policy definitions (permission denied on `execute_sql`). This means I cannot confirm whether write policies require `authenticated` role or allow `anon`. **This is the single most important thing to verify.**

### Schema weaknesses

| Table | Column | Issue |
|-------|--------|-------|
| `inventory` | `price` | **`text` type** — no numeric constraint. A REST call with `price: "banana"` succeeds at DB level. Same for `cost`, `sold_price`, `lot_sold_price`. |
| `inventory` | `name`, `details`, `brand` | Not nullable per schema, but no explicit `NOT NULL` shown; only `price` and `qty` appear required. A POST with empty `name` may succeed. |
| `expenses` | `amount` | **`text` type** — same issue as prices above. |
| `shows` | `name`, `date`, `location_name`, `address` | Listed as non-nullable, which is good. |
| `site_settings` | `key`, `value` | Both non-nullable (PK is `key`). Acceptable for KV store, but no CHECK on key names so arbitrary keys can be inserted. |
| `inventory` | `category` | **Has a CHECK constraint** limiting to `['slabs','sealed','raw','accessories','collectibles']`. This is good. |
| `payment_methods` | `type` | No CHECK constraint; any string accepted despite UI offering only `qr` or `cash`. |
| `shows` | `show_type` | No CHECK constraint; defaults to `'vending'` but no enforcement. |

### Storage buckets
All uploads go to a single bucket `card-images` (lines 1475, 1869, 3096, 3205). The upload uses `Bearer ${accessToken}` so it requires auth. However:
- The public read URL pattern (`/storage/v1/object/public/card-images/`) means the bucket is set to **public read** — acceptable for images shown on the storefront.
- File names are user-controlled (sanitized only by replacing non-alphanum with `_`). No server-side content-type validation beyond the `Content-Type` header the client sets.
- The item upload `accept` attribute (line 1213) includes `application/pdf` but the drop-zone hint says "JPG, PNG, WebP" — mismatch.

### Anon key exposure
Line 1313 exposes the Supabase anon key in client-side JS. This is **expected** for Supabase — security depends entirely on RLS policies. But it means if any write policy allows `anon`, anyone can modify data.

---

## 2. Validation (2/5)

### Client-side only validation (no DB enforcement)

| What | Where in JS | DB enforcement |
|------|-------------|----------------|
| Item name required | `required` attr, line 1196 | Column is NOT NULL — OK |
| Item price required | `required` attr, line 1199 | Column is NOT NULL — OK, but `text` type accepts non-numeric |
| Price format (`data-money`) | `formatMoney()`, line 2550-2560, blur only | None — `$banana` stored as-is after format attempt |
| Item qty `min="1"` | HTML attr, line 1201 | Column is `integer` with default 1, no CHECK >= 1 |
| File size < 5MB | JS check, lines 1471, 1869, 3201 | No server-side enforcement — Supabase storage has its own limit but it's configurable |
| Category is valid enum | `<select>` element, line 1206 | **CHECK constraint exists** — good |
| Show date required | `required` attr, line 1246 | NOT NULL — OK |
| Expense amount required | `required` attr, line 857 | NOT NULL — OK, but text type |
| Payment method name | `required` attr, line 929 | NOT NULL — OK |

### Missing validation entirely

- **No XSS sanitization on output.** `item.name`, `item.details`, `item.notes`, etc. are inserted via `innerHTML` without escaping in multiple places (lines 1959-1966, 2250-2258, 2289-2297). The `safeName` variable (line 1964) only escapes for the `data-name` attribute, not the main cell content. A name containing `<script>` or `<img onerror=...>` would execute.
- `parseMoney()` (line 2805) silently returns 0 for invalid input — financials will be wrong if price data is corrupted.
- No max-length enforcement on any text field at DB level.

---

## 3. Inventory & Financials CRUD (4/5)

### What works well
- **Full CRUD**: Add, edit, delete items (lines 1857-1880)
- **Bulk operations**: Sell, show/hide, feature/unfeature, change category, delete (lines 2700-2761)
- **Partial sell**: When qty > 1, can sell a subset, creating a split record (lines 2036-2052)
- **Lot management**: Group sold items into lots, edit lot metadata, delete lots (lines 2391-2461)
- **Expenses CRUD**: Add, edit, delete with category breakdown (lines 2463-2540)
- **Financials dashboard**: Revenue, cost, gross/net profit, margin, per-show/brand breakdowns, charts (lines 2807-3025)

### Issues

- **No DB-level pagination.** `loadInventory()` (line 1801) fetches `inventory?select=*&sold=eq.false` — all rows. Pagination is client-side only (line 1884, `INV_PER_PAGE = 25`). Same for `loadSold()` (line 2076), `loadFinancials()` (line 2809), and analytics (line 1636). With 90 rows this is fine today but won't scale.
- **N+1 updates in bulk ops.** `bulkVisibility()` (line 2722), `bulkFeature()` (line 2730), `bulkDelete()` (line 2757), `bulkChangeCategory()` (line 2742), `editLotForm` submit (line 2431), and `saveSellSection()` (line 3138) all loop individual PATCH/DELETE calls. PostgREST supports `?id=in.(id1,id2)` for batch updates.
- **`loadInventory()` makes a second fetch** for sold count (line 2818): `apiGet('inventory?select=id&sold=eq.true')`. This is an N+1 on every inventory load.
- **No optimistic UI.** Every mutation triggers a full reload via `loadInventory()` or `loadSold()`.

---

## 4. UX States (2/5)

### What exists
- **Toast notifications** for success/error (line 3456)
- **Loading text** in table bodies on initial load (e.g., line 512)
- **Button disable + text change** during save on: item form (line 1875), sold form (lines 2024-2025), edit sold form (lines 2338-2339)

### What's missing

| Gap | Location | Impact |
|-----|----------|--------|
| **No loading state on most save buttons** | `saveSellSection()` line 3125, `saveSeo()` line 3156, `saveAnnouncement()` line 3264, `saveHeroText()` line 3285, `saveCatDescs()` line 3314, `saveStatsBar()` line 3224, `saveHeroBg()` line 3182, payment form line 1487 | User can double-click, causing duplicate submissions |
| **Silent error swallowing** | `loadPriceSetting()` line 2769 `catch(e) {}`, `loadPasswordSetting()` line 2789, `loadSellBadges()` line 3122, `loadSeo()` line 3153, `loadAnnouncement()` line 3261, `loadHeroText()` line 3282, `loadHeroBg()` line 3179, `loadStatsBar()` line 3221, `loadShowCarouselInterval()` line 3240, `loadHeroShowcase()` line 3335 sub-try line 3333 | Settings silently fail to load with no indication |
| **No empty state for analytics** | `loadAnalytics()` line 1627 | If API fails, only `console.error` (line 1747) — dashboard stays on "Loading..." or shows stale data |
| **No confirmation on destructive multi-item ops** | `bulkSell()` line 2700 — no confirm dialog for selling multiple items | Accidental bulk sell with no undo |
| **No undo for delete** | `confirmDelete()` line 2880 | Hard delete, no soft-delete or trash |
| **Show form has no loading state** | `showForm` submit, line 3031 | Button stays clickable during save |

---

## 5. Architecture & Duplication (2/5)

### Quantified duplication

| Pattern | Instances | Lines each | Total |
|---------|-----------|------------|-------|
| Drop-zone upload (drag/drop/click/file handler) | 4 (item, flyer, payment, hero-bg) | ~25 lines | ~100 lines |
| Modal open/close/populate | 13 modals | ~15-30 lines | ~300 lines |
| CRUD form submit (gather fields, apiPost/apiPatch, toast, reload) | 8 forms | ~20-30 lines | ~200 lines |
| Load + render table (apiGet, innerHTML loop, empty state) | 5 sections | ~30-50 lines | ~200 lines |
| Site settings load/save pairs | 10 features | ~15-20 lines each | ~175 lines |

**Estimated reducible duplication: ~975 lines (28% of the JS)**

### Proposed refactors

| Refactor | What | Effort | Lines saved |
|----------|------|--------|-------------|
| `createUploader(config)` factory | Unify 4 drag-drop upload blocks into one reusable function | 2 hours | ~75 lines |
| `openModal(id, fields)` / `closeModal(id)` helper | Generic modal management | 1 hour | ~50 lines |
| `crudForm(tableOrEndpoint, fieldsConfig)` | Generic form submit handler with validation | 3 hours | ~150 lines |
| `settingsPair(key, elementId)` | Generic site_settings load/save | 1 hour | ~120 lines |
| `renderTable(data, columns, config)` | Generic table renderer | 3 hours | ~150 lines |
| Extract JS to separate file | Move `<script>` to `admin.js` | 30 min | 0 (but improves maintainability) |
| Extract CSS to separate file | Move `<style>` to `admin.css` | 30 min | 0 (but enables caching) |

**Total effort estimate: ~11 hours for ~545 lines saved + much better maintainability**

### 3,460-line single file
The entire admin (HTML + CSS + JS) is in one file. CSS is ~285 lines (14-285), HTML is ~1025 lines (287-1311), JS is ~2150 lines (1311-3460). This is manageable for a solo developer but will become painful for any collaboration.

---

## 6. Mobile Usability (3/5)

### What works
- Sidebar collapses to 60px icon-only on `max-width: 768px` (line 272-284)
- Stat grids reflow to 2 columns (line 280)
- Two-column layouts become single-column (line 281)
- Form rows become single-column (line 282)
- Tables get horizontal scroll wrapper (`.table-scroll`, line 206)

### Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Tables still `min-width: 700px` on mobile (line 283 sets 600px) — requires scrolling | Lines 207, 283 | P2 |
| Modals have fixed `max-width: 560px` with no mobile override | Line 233 | P1 — could overflow on small phones |
| 5-column KPI grid has no mobile breakpoint | Line 381 (only `#kpiGrid` has 2-col at 768px, line 128) | P2 |
| 6-column financials KPI grid has no mobile breakpoint | Line 766 | P1 — tiny cards on mobile |
| 3-column inventory/brand/category grid has no mobile breakpoint | Line 418 | P1 |
| Bulk action buttons may wrap awkwardly | Line 458 | P2 |
| Calendar grid on mobile has very small day cells | Line 914 | P2 |
| No touch-friendly drag-and-drop for reorder | Lines 3411-3453 | P1 — drag events don't work well on touch |

---

## 7. Performance (2/5)

### Issues

| Issue | Location | Impact |
|-------|----------|--------|
| **All page_views loaded in one request** | Line 1636: `page_views?select=*&created_at=gte.${prevSince}` — for "All time" (365 days), this loads ALL 733+ rows with ALL columns | Network/memory; grows linearly with traffic |
| **All analytics_events loaded** | Line 1637: same pattern, 2027+ rows | Same |
| **Entire inventory loaded on every CRUD op** | `loadInventory()` called after every add/edit/delete/visibility toggle/sell | Could use targeted DOM updates instead of full re-fetch + re-render |
| **N+1 PATCHes in bulk operations** | `bulkVisibility`, `bulkFeature`, `bulkChangeCategory`, `bulkDelete`, `editLotForm`, `saveSellSection`, `saveSeo`, `saveCatDescs` all loop individual API calls | 10 items = 10 HTTP requests; could use PostgREST bulk filters |
| **Sold count extra fetch** | Line 2818: separate `apiGet('inventory?select=id&sold=eq.true')` on every inventory load | Extra round-trip; could use a DB view or count header |
| **`select=*` everywhere** | Lines 1801, 2076, 2809-2812, 3028, 3101, etc. | Fetches all columns including unused ones like `updated_at` |
| **No request debouncing on search** | Line 480: `oninput="invPage=1;renderInventoryPage();"` — filters in-memory so fast enough; but `soldSearch` (line 530) calls `renderSold()` which re-renders all HTML on every keystroke | DOM thrashing |
| **Full re-render on page navigation** | `navigateToPage('site')` at line 1611 fires 12 separate API calls | Waterfall of sequential requests; could parallelize with `Promise.all` |
| **No caching** | Every page switch re-fetches everything | Could cache with TTL |
| **CSS and JS not in separate files** | Lines 14-285 (CSS), 1311-3460 (JS) are inline | No browser caching; 229KB transferred every page load |

---

## 8. Design Quality & Visual Craft (4/5)

### Strengths
- **Cohesive design system**: CSS custom properties for colors, spacing, and transitions (lines 16-36)
- **Dark + light mode**: Full theme support via `data-theme` attribute (lines 27-36)
- **Consistent component vocabulary**: `.stat-card`, `.panel`, `.tbl`, `.btn`, `.form-input`, `.modal-overlay` etc.
- **Good type scale**: Label (0.6-0.65rem), body (0.8-0.85rem), heading (1.15rem), stat values (1.8rem)
- **Visual hierarchy**: Gold accent for primary actions, semantic colors (green=success, red=danger, blue=info)
- **Micro-interactions**: Hover states, focus rings (`box-shadow: 0 0 0 2px var(--gold-glow)`), modal entrance animation (line 236)
- **Sidebar persistence**: Remembers collapsed state in localStorage (line 1521)
- **Theme persistence**: Remembers dark/light in localStorage (line 1534)

### Weaknesses

| Issue | Location | Severity |
|-------|----------|----------|
| Inconsistent modal containers: `.modal` vs `.modal-box` | Lines 233-235 — two different modal inner containers used interchangeably | P2 |
| Emoji used as icons (📷, 🖼️, 📝, 📋, 👁️, 🚫) instead of consistent SVG icon set | Lines 942, 1105, 1211, 1421, etc. | P2 |
| Inline styles used heavily in HTML | Lines 381, 418, 766, 776, etc. — `style="display:grid;grid-template-columns:repeat(5,1fr);..."` | P2 — should be CSS classes |
| No focus management when modals open | All `classList.add('active')` calls | P1 — accessibility issue, focus stays on trigger button |
| No ARIA attributes on modals | Lines 232-241 | P1 — screen readers can't identify dialog role |
| Delete confirmation uses `confirm()` for some operations but a custom modal for inventory delete | `confirm()` at lines 2383, 2453, 2509, 2720, 2742, 2755 vs custom modal at line 1301 | P2 — inconsistent UX |
| Tables lack `scope="col"` on headers | Lines 500-511 | P2 — accessibility |

---

## Prioritized Fix List

### P0 — Data-loss / Security

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| P0-1 | **Verify RLS write policies require `authenticated` role** | Supabase dashboard → Auth Policies | Run `SELECT * FROM pg_policies WHERE schemaname='public'` in Supabase SQL editor. Ensure every INSERT/UPDATE/DELETE policy has `roles = '{authenticated}'` not `'{anon}'`. If anon can write, anyone with the anon key (exposed line 1313) can modify all business data. |
| P0-2 | **XSS via innerHTML injection** | Lines 1959 (`item.name` unescaped), 2250-2258 (sold items), 2289 (individual table), 1420-1422 (payments), 3102 (links) | Create a `escapeHtml()` utility and apply to ALL user-provided strings before inserting into `innerHTML`. Alternatively, use `textContent` or a DOM builder. |
| P0-3 | **Price/amount stored as `text`** | `inventory.price`, `inventory.cost`, `inventory.sold_price`, `inventory.lot_sold_price`, `expenses.amount` | Migrate to `numeric(10,2)` columns. This prevents data corruption and enables DB-level aggregation. Current `parseMoney()` silently returns 0 for garbage data. |
| P0-4 | **No NOT NULL on critical inventory fields** | `inventory.name`, `inventory.details`, `inventory.brand` show as non-nullable in schema but verify; `inventory.price` needs NOT NULL | Add `ALTER TABLE inventory ALTER COLUMN name SET NOT NULL` etc. for business-critical fields. |
| P0-5 | **Storage bucket policy audit** | `card-images` bucket | Verify in Supabase dashboard that the bucket policy requires authenticated role for INSERT/UPDATE/DELETE. Public READ is fine. |
| P0-6 | **Verify no `anon` INSERT on `site_settings`** | RLS policies | An unauthenticated user could insert arbitrary site_settings keys (like `site_password`) if INSERT is open to anon. |
| P0-7 | **Bulk sell has no confirmation dialog** | `bulkSell()` line 2700 | Add `confirm()` before opening the sold modal for bulk operations to prevent accidental mass sell. |

### P1 — Broken / Confusing / Unprofessional

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| P1-1 | **Silent error swallowing on settings load** | Lines 2769, 2789, 3122, 3153, 3261, 3282, 3179, 3221, 3240, 3333 — all `catch(e) {}` | At minimum log the error; ideally show a subtle "Failed to load [setting]" indicator |
| P1-2 | **No loading/disabled state on most save buttons** | `saveSellSection`, `saveSeo`, `saveAnnouncement`, `saveHeroText`, `saveCatDescs`, `saveStatsBar`, `saveHeroBg`, payment form | Disable button + show "Saving..." text during async operation to prevent double-submit |
| P1-3 | **N+1 PATCH calls in bulk ops** | Lines 2722, 2730, 2742, 2757, 2431, 2667, 3138 | Use PostgREST filter `?id=in.(id1,id2,id3)` for single PATCH/DELETE call |
| P1-4 | **Financials 6-col and 3-col grids have no mobile breakpoint** | Lines 766, 418 | Add `@media (max-width: 768px)` rules to reflow to 2-col or 1-col |
| P1-5 | **Modals lack focus management and ARIA roles** | All modal-overlay elements | Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; trap focus inside modal; focus first input on open |
| P1-6 | **Drag-to-reorder doesn't work on touch devices** | Lines 3411-3453 | Add touch event handlers or use a library like SortableJS |
| P1-7 | **`accept` attribute includes PDF but hint says JPG/PNG/WebP** | Line 1213: `accept="image/jpeg,image/png,image/webp,application/pdf"` | Remove `application/pdf` from accept or update the hint |
| P1-8 | **Inconsistent delete UX** | Custom modal for inventory (line 1301), browser `confirm()` for shows/links/payments/expenses/lots | Pick one pattern and use it everywhere |
| P1-9 | **Site page fires 12 sequential API calls on load** | Line 1611 | Wrap in `Promise.all()` for parallel loading |
| P1-10 | **No CHECK constraint on `payment_methods.type` or `shows.show_type`** | DB schema | Add `CHECK (type IN ('qr','cash'))` and `CHECK (show_type IN ('vending','attending'))` |

### P2 — Polish

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| P2-1 | **Inline styles on grid layouts** | Lines 381, 418, 766, 776 | Extract to named CSS classes |
| P2-2 | **Emoji icons instead of SVG** | Scattered throughout (📷, 🖼️, 📝, 📋, 👁️, 🚫) | Replace with SVG icons matching the sidebar icon style |
| P2-3 | **Two modal inner container classes** | `.modal` (line 233) vs `.modal-box` (line 235) | Consolidate to single class |
| P2-4 | **`select=*` on all queries** | Lines 1801, 2076, 2809, etc. | Select only needed columns |
| P2-5 | **No debounce on sold search** | Line 530: `oninput="renderSold()"` | Add 200ms debounce |
| P2-6 | **CSS and JS inline in HTML** | Entire file | Extract to `admin.css` and `admin.js` for browser caching |
| P2-7 | **Pagination is client-side only** | Line 1884 `INV_PER_PAGE = 25` | Add PostgREST `limit` and `offset` params; use `Range` header for count |
| P2-8 | **Analytics loads all historical data** | Line 1636 | For "All time" option, use DB aggregation or at minimum select only needed columns (`created_at, visitor_id, is_mobile, referrer, utm_source, timezone`) |
| P2-9 | **No table header `scope` attributes** | All `<th>` elements | Add `scope="col"` for accessibility |
| P2-10 | **Calendar doesn't handle multi-day shows** | `renderCalendar()` line 3049 only checks start date, ignores `end_date` | Check if show spans multiple days and render on each |
| P2-11 | **Full inventory reload after every single-item edit** | Lines 1855, 1875, 1880 all call `loadInventory()` | Consider targeted DOM update for single-item mutations |
| P2-12 | **Refactor upload handlers** | 4 near-identical blocks (~100 lines) | Create `createDropZone(config)` factory |

---

## Summary

The admin panel is a **well-designed, feature-complete single-file application** for a small trading card business. The dark-mode UI is polished, the CRUD coverage is thorough, and the financial reporting is impressive for a solo project.

The most urgent issues are:

1. **Verify RLS policies** (P0-1) — this cannot be assessed without SQL access and is the single biggest risk
2. **XSS vulnerabilities** (P0-2) — innerHTML injection is exploitable if any user-provided data contains HTML
3. **Numeric data stored as text** (P0-3) — corrupted price data silently breaks financials

The architecture is reasonable for a ~90-item inventory but will need refactoring before it grows significantly. The recommended 11-hour refactoring investment would eliminate ~28% of JS duplication and make the codebase much more maintainable.
