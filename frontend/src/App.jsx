import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { AdminAuthProvider } from "./context/AdminAuthContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import AdminProtectedRoute from "./routes/AdminProtectedRoute";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import AnimatedPsi from "./components/AnimatedPsi";
import i18n from "./i18n";

// Wraps a page's dynamic import so that, whenever this page's chunk is
// fetched, its i18n translation bundle is fetched and merged into i18next
// (`addResourceBundle`) at the exact same time — both requests fire
// together, and React's Suspense (see RouteLoadingFallback below) waits for
// both before showing the page. That means an admin page's strings are
// already registered under the "admin" namespace key by the time the page's
// JSX first tries to read them via t('admin.overview.title') etc., so
// there's never a flash of raw untranslated keys.
// `true, true` on addResourceBundle mean: deep-merge (not replace) into
// whatever's already registered under that language/namespace, and DO
// overwrite any existing keys — safe to call repeatedly if this loader ever
// re-runs.
function lazyPageWithTranslations(pageImport, translationsImport, namespace) {
  return lazy(async () => {
    const [translations, pageModule] = await Promise.all([
      translationsImport(),
      pageImport(),
    ]);
    i18n.addResourceBundle('en', 'translation', { [namespace]: translations.default }, true, true);
    return pageModule;
  });
}

// Every page below is loaded with React's `lazy()` instead of a normal static
// `import`. A static import bakes the page's code into the ONE big bundle
// that ships to every visitor on first load, no matter which page they
// actually land on. `lazy()` instead tells Vite to build that page as its
// own separate chunk file, which the browser only fetches the moment the
// user actually navigates to that route. Net effect: someone who only ever
// visits /login never downloads the admin panel, the bot-creation wizard, or
// any of the other 20+ pages they didn't ask for — first load gets much
// smaller and faster, especially on a slow connection.
//
// To add a new page and keep it code-split, follow this same pattern:
//   const MyNewPage = lazy(() => import("./pages/MyNewPage"));
// Do NOT go back to `import MyNewPage from "./pages/MyNewPage"` at the top
// of the file — that would pull it back into the main bundle for everyone.
const SignupPage = lazy(() => import("./pages/SignupPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const MarketsPage = lazy(() => import("./pages/MarketsPage"));
const TradePage = lazy(() => import("./pages/TradePage"));
const MenuPage = lazy(() => import("./pages/MenuPage"));
const DepositPage = lazy(() => import("./pages/DepositPage"));
const WithdrawPage = lazy(() => import("./pages/WithdrawPage"));
const ConvertPage = lazy(() => import("./pages/ConvertPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));
const BotsPage = lazy(() => import("./pages/BotsPage"));
const BotDetailPage = lazy(() => import("./pages/BotDetailPage"));
const CreateBotPage = lazy(() => import("./pages/CreateBotPage"));
const FakeSessionPage = lazy(() => import("./pages/FakeSessionPage"));
const KycPage = lazy(() => import("./pages/KycPage"));
const WalletHistoryPage = lazy(() => import("./pages/WalletHistoryPage"));
// Admin pages use lazyPageWithTranslations instead of plain lazy() — see
// that helper's comment above — so the admin i18n bundle (src/i18n/admin-en.js)
// only ever reaches a browser that's actually loading an admin page.
const AdminLoginPage = lazyPageWithTranslations(() => import("./pages/AdminLoginPage"), () => import("./i18n/admin-en.js"), "admin");
const AdminOverviewPage = lazyPageWithTranslations(() => import("./pages/AdminOverviewPage"), () => import("./i18n/admin-en.js"), "admin");
const AdminWinRatePage = lazyPageWithTranslations(() => import("./pages/AdminWinRatePage"), () => import("./i18n/admin-en.js"), "admin");
const AdminSessionLimitsPage = lazyPageWithTranslations(() => import("./pages/AdminSessionLimitsPage"), () => import("./i18n/admin-en.js"), "admin");
const AdminBalancePage = lazyPageWithTranslations(() => import("./pages/AdminBalancePage"), () => import("./i18n/admin-en.js"), "admin");
const AdminWithdrawalFeePage = lazyPageWithTranslations(() => import("./pages/AdminWithdrawalFeePage"), () => import("./i18n/admin-en.js"), "admin");
const AdminUnlockFeesPage = lazyPageWithTranslations(() => import("./pages/AdminUnlockFeesPage"), () => import("./i18n/admin-en.js"), "admin");
const AdminKycQueuePage = lazyPageWithTranslations(() => import("./pages/AdminKycQueuePage"), () => import("./i18n/admin-en.js"), "admin");
const AdminWithdrawalsQueuePage = lazyPageWithTranslations(() => import("./pages/AdminWithdrawalsQueuePage"), () => import("./i18n/admin-en.js"), "admin");
const AdminConsolidationAddressesPage = lazyPageWithTranslations(() => import("./pages/AdminConsolidationAddressesPage"), () => import("./i18n/admin-en.js"), "admin");
const AdminSweepsPage = lazyPageWithTranslations(() => import("./pages/AdminSweepsPage"), () => import("./i18n/admin-en.js"), "admin");

// Shown while a lazy page's chunk is still downloading — e.g. right after
// clicking a nav link, before that page's JS has arrived. Deliberately the
// exact same spinner ProtectedRoute.jsx already shows while auth is
// resolving, so a user never sees two different "loading" visuals depending
// on which kind of wait they hit.
function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <AnimatedPsi mode="working" size={36} color="var(--teal-base)" />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
          <AdminAuthProvider>
            <BrowserRouter>
            {/* Single Suspense boundary around the whole route tree: since
                every page above is lazy(), React "suspends" rendering
                whichever page is being navigated to until its chunk has
                finished downloading. This one boundary catches that
                suspend for ANY route and shows the fallback spinner during
                that gap — no need to wrap each individual <Route> in its
                own Suspense. */}
            <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Tab-root screens — all 6 bottom-nav destinations now live
                here (see TabBar.jsx). AppShell renders the fixed tab bar
                around whichever of these is active via a nested
                <Outlet/>. Pushed screens reached FROM one of these (bot
                detail, deposit, withdraw, KYC, the create-bot wizard) stay
                outside this group, further down — they keep their own
                back-chevron top nav and no tab bar, since you navigate
                back out of them rather than switching tabs. */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/trade" element={<TradePage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/menu" element={<MenuPage />} />
            </Route>

            <Route
              path="/wallet/history"
              element={
                <ProtectedRoute>
                  <WalletHistoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/deposit"
              element={
                <ProtectedRoute>
                  <DepositPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/withdraw"
              element={
                <ProtectedRoute>
                  <WithdrawPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/convert"
              element={
                <ProtectedRoute>
                  <ConvertPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/create"
              element={
                <ProtectedRoute>
                  <CreateBotPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/demo"
              element={
                <ProtectedRoute>
                  <FakeSessionPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bots/:botId"
              element={
                <ProtectedRoute>
                  <BotDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/kyc"
              element={
                <ProtectedRoute>
                  <KycPage />
                </ProtectedRoute>
              }
            />

            {/* Admin — a separate credential from the regular user routes
                above (see AdminAuthContext.jsx); /admin/login is public,
                everything else under /admin requires an admin session.
                Bare "/admin" (the URL anyone types first) previously had no
                matching route at all, which rendered nothing — a blank
                page with no clue what went wrong. Redirecting it to
                /admin/overview isn't a security shortcut: that route is
                itself wrapped in AdminProtectedRoute below, so an
                unauthenticated visit still bounces on to /admin/login —
                this just gives bare "/admin" ANY sensible destination
                instead of none. */}
            <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route
              path="/admin/overview"
              element={
                <AdminProtectedRoute>
                  <AdminOverviewPage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/win-rate"
              element={
                <AdminProtectedRoute>
                  <AdminWinRatePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/session-limits"
              element={
                <AdminProtectedRoute>
                  <AdminSessionLimitsPage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/balance"
              element={
                <AdminProtectedRoute>
                  <AdminBalancePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/withdrawal-fee"
              element={
                <AdminProtectedRoute>
                  <AdminWithdrawalFeePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/withdrawal-unlock-fees"
              element={
                <AdminProtectedRoute>
                  <AdminUnlockFeesPage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/kyc"
              element={
                <AdminProtectedRoute>
                  <AdminKycQueuePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/withdrawals"
              element={
                <AdminProtectedRoute>
                  <AdminWithdrawalsQueuePage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/consolidation-addresses"
              element={
                <AdminProtectedRoute>
                  <AdminConsolidationAddressesPage />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/sweeps"
              element={
                <AdminProtectedRoute>
                  <AdminSweepsPage />
                </AdminProtectedRoute>
              }
            />
          </Routes>
            </Suspense>
            </BrowserRouter>
          </AdminAuthProvider>
        </AuthProvider>
      </ThemeProvider>
      {/* Rendered once here, outside the router, so it survives route
          changes and stays available to every screen — including the
          login/signup pages, which sit above ProtectedRoute and would
          otherwise have no toast layer at all. */}
      <Toast />
    </ToastProvider>
  );
}

export default App;
