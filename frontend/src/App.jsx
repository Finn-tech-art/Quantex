import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { AdminAuthProvider } from "./context/AdminAuthContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import AdminProtectedRoute from "./routes/AdminProtectedRoute";
import AppShell from "./components/AppShell";
import Toast from "./components/Toast";
import SignupPage from "./pages/SignupPage";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import MarketsPage from "./pages/MarketsPage";
import TradePage from "./pages/TradePage";
import MenuPage from "./pages/MenuPage";
import DepositPage from "./pages/DepositPage";
import WithdrawPage from "./pages/WithdrawPage";
import ConvertPage from "./pages/ConvertPage";
import WalletPage from "./pages/WalletPage";
import BotsPage from "./pages/BotsPage";
import BotDetailPage from "./pages/BotDetailPage";
import CreateBotPage from "./pages/CreateBotPage";
import FakeSessionPage from "./pages/FakeSessionPage";
import KycPage from "./pages/KycPage";
import WalletHistoryPage from "./pages/WalletHistoryPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import AdminWinRatePage from "./pages/AdminWinRatePage";
import AdminSessionLimitsPage from "./pages/AdminSessionLimitsPage";
import AdminWithdrawalFeePage from "./pages/AdminWithdrawalFeePage";
import AdminUnlockFeesPage from "./pages/AdminUnlockFeesPage";
import AdminKycQueuePage from "./pages/AdminKycQueuePage";
import AdminWithdrawalsQueuePage from "./pages/AdminWithdrawalsQueuePage";
import AdminConsolidationAddressesPage from "./pages/AdminConsolidationAddressesPage";
import AdminSweepsPage from "./pages/AdminSweepsPage";

function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
          <AdminAuthProvider>
            <BrowserRouter>
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
