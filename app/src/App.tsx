import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './auth/LoginPage'
import { AppLayout } from './layout/AppLayout'
import { HomePage } from './pages/HomePage'
import { SetupPage } from './pages/SetupPage'
import { IntegrationsPage } from './pages/IntegrationsPage'
import { RegistryPage } from './pages/RegistryPage'
import { RegistryDetailPage } from './pages/RegistryDetailPage'
import { ControlsPage } from './pages/ControlsPage'
import { ControlsDetailPage } from './pages/ControlsDetailPage'
import { PoliciesPage } from './pages/PoliciesPage'
import { PoliciesDetailPage } from './pages/PoliciesDetailPage'
import { FrameworksPage } from './pages/FrameworksPage'
import { FrameworkDetailPage } from './pages/FrameworkDetailPage'
import { BuiltinFrameworkPage } from './pages/BuiltinFrameworkPage'
import { MonitoringPage } from './pages/MonitoringPage'
import { OrganisationPage } from './pages/OrganisationPage'
import { SettingsPage } from './pages/SettingsPage'
import { OAuthConsentPage } from './pages/OAuthConsentPage'
import { PortalBridgePage } from './pages/PortalBridgePage'
import { LegacyPortalRedirect } from './pages/LegacyPortalRedirect'
import { UsersPage } from './pages/UsersPage'
import { BillingPage } from './pages/BillingPage'
import { PlansPage } from './pages/PlansPage'
import { AlertsPage } from './pages/AlertsPage'
import { ReportsPage } from './pages/ReportsPage'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { DataBackendsPage } from './pages/DataBackendsPage'
import { AuthenticationPage } from './pages/AuthenticationPage'

/**
 * React app is the primary shell. Legacy portal remains at /legacy/portal.html
 * and /portal/* for bridge / parity checks.
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NuqsAdapter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/oauth/consent"
              element={
                <RequireAuth>
                  <OAuthConsentPage />
                </RequireAuth>
              }
            />
            {/* Optional full-document portal bridge */}
            <Route
              path="/portal"
              element={
                <RequireAuth>
                  <PortalBridgePage hash="dashboard" />
                </RequireAuth>
              }
            />
            <Route
              path="/portal/:view"
              element={
                <RequireAuth>
                  <PortalBridgePage />
                </RequireAuth>
              }
            />
            <Route
              path="/portal/:view/:id"
              element={
                <RequireAuth>
                  <PortalBridgePage />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/registry" replace />} />
              <Route path="setup" element={<SetupPage />} />
              <Route path="registry" element={<RegistryPage />} />
              <Route path="registry/:id" element={<RegistryDetailPage />} />
              <Route path="frameworks" element={<FrameworksPage />} />
              <Route path="frameworks/builtin/:slug" element={<BuiltinFrameworkPage />} />
              <Route path="frameworks/:id" element={<FrameworkDetailPage />} />
              <Route path="controls" element={<ControlsPage />} />
              <Route path="controls/:id" element={<ControlsDetailPage />} />
              <Route path="policies" element={<PoliciesPage />} />
              <Route path="policies/:id" element={<PoliciesDetailPage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="monitoring" element={<MonitoringPage />} />
              <Route path="organisation" element={<OrganisationPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
              <Route path="data-backends" element={<DataBackendsPage />} />
              <Route path="authentication" element={<AuthenticationPage />} />
              <Route path="home" element={<HomePage />} />
              <Route path="legacy-portal" element={<LegacyPortalRedirect hash="dashboard" />} />
            </Route>
            <Route path="*" element={<Navigate to="/registry" replace />} />
          </Routes>
        </NuqsAdapter>
      </BrowserRouter>
    </AuthProvider>
  )
}
