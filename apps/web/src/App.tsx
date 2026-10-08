import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardOverview from './pages/DashboardOverview';
import { Integrations } from './pages/Integrations';
import WorkflowCenter from './pages/workflows/WorkflowCenter';
import { WorkflowBuilder } from './pages/workflows/WorkflowBuilder';
import TemplateDetails from './pages/workflows/TemplateDetails';
import OAuthCallback from './pages/OAuthCallback';
import ProtectedRoute from './components/ProtectedRoute';

import KnowledgeCenter from './pages/knowledge/KnowledgeCenter';
import KnowledgeBaseDetails from './pages/knowledge/KnowledgeBaseDetails';

import WorkflowPacks from './pages/workflows/WorkflowPacks';
import Drafts from './pages/workflows/Drafts';
import Opportunities from './pages/workflows/Opportunities';
import Approvals from './pages/workflows/Approvals';
import Executions from './pages/workflows/Executions';

import Analytics from './pages/integrations/Analytics';
import Settings from './pages/Settings';
import { GoogleCalendarUI } from './pages/integrations/GoogleCalendarUI';
import EnquiryInbox from './pages/enquiries/EnquiryInbox';
import EnquiryDetail from './pages/enquiries/EnquiryDetail';
import OrderList from './pages/orders/OrderList';
import OrderDetail from './pages/orders/OrderDetail';
import BusinessData from './pages/enquiries/BusinessData';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        
        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardOverview />} />
            <Route path="calendar" element={<GoogleCalendarUI />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="integrations/analytics" element={<Analytics />} />

            <Route path="enquiries" element={<EnquiryInbox />} />
            <Route path="business-data" element={<BusinessData />} />
            <Route path="enquiries/:id" element={<EnquiryDetail />} />
            <Route path="orders" element={<OrderList />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            
            <Route path="workflow-packs" element={<WorkflowPacks />} />
            <Route path="workflows" element={<WorkflowCenter />} />
            <Route path="workflows/drafts" element={<Drafts />} />
            <Route path="workflows/opportunities" element={<Opportunities />} />
            <Route path="workflows/approvals" element={<Approvals />} />
            <Route path="workflows/executions" element={<Executions />} />
            <Route path="workflows/:id" element={<WorkflowBuilder />} />
            <Route path="templates/:id" element={<TemplateDetails />} />
            
            <Route path="knowledge" element={<KnowledgeCenter />} />
            <Route path="knowledge/:id" element={<KnowledgeBaseDetails />} />
            
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="/api/auth/callback/:provider" element={<OAuthCallback />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App;

