import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { MlaAuthProvider } from './auth/MlaAuthProvider'
import { RequireMlaAdmin } from './auth/RequireMlaAdmin'
import { LoginPage } from './auth/LoginPage'
import { AdminLayout } from './layout/AdminLayout'
import { HomePage } from './pages/HomePage'
import { ControlsCataloguePage } from './pages/ControlsCataloguePage'
import { FrameworksCataloguePage } from './pages/FrameworksCataloguePage'
import { MappingsPage } from './pages/MappingsPage'
import { PoliciesCataloguePage } from './pages/PoliciesCataloguePage'
import { DiagnosticScoringPage } from './pages/DiagnosticScoringPage'
import { DiagnosticRegsPage } from './pages/DiagnosticRegsPage'
import { AssessmentQuestionsPage } from './pages/AssessmentQuestionsPage'
import { DiagnosticQuestionsPage } from './pages/DiagnosticQuestionsPage'
import { MethodologyVersionsPage } from './pages/MethodologyVersionsPage'

export default function App() {
  return (
    <MlaAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireMlaAdmin>
                <AdminLayout />
              </RequireMlaAdmin>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="controls" element={<ControlsCataloguePage />} />
            <Route path="frameworks" element={<FrameworksCataloguePage />} />
            <Route path="mappings" element={<MappingsPage />} />
            <Route path="policies" element={<PoliciesCataloguePage />} />
            <Route path="methodology-versions" element={<MethodologyVersionsPage />} />
            <Route path="diagnostic-scoring" element={<DiagnosticScoringPage />} />
            <Route path="diagnostic-regs" element={<DiagnosticRegsPage />} />
            <Route path="diagnostic-questions" element={<DiagnosticQuestionsPage />} />
            <Route path="assessment-questions" element={<AssessmentQuestionsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MlaAuthProvider>
  )
}
