import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, Protected, Gate } from "./lib/auth";
import SiteLayout from "./components/public/SiteLayout";
import Home from "./pages/public/Home";
import Catalogue from "./pages/public/Catalogue";
import PropertyDetail from "./pages/public/PropertyDetail";
import ListProperty from "./pages/public/ListProperty";
import { Services, ServiceDetail, About, Contact, Faq, Legal } from "./pages/public/Pages";
import ErpLayout from "./components/erp/ErpLayout";
import { Login, ResetPassword } from "./pages/erp/Login";
import Dashboard from "./pages/erp/Dashboard";
import Leads from "./pages/erp/Leads";
import LeadDetail from "./pages/erp/LeadDetail";
import Properties from "./pages/erp/Properties";
import ErpProperty from "./pages/erp/ErpProperty";
import Owners from "./pages/erp/Owners";
import { Deals, DealDetail } from "./pages/erp/Deals";
import Finance from "./pages/erp/Finance";
import Leases from "./pages/erp/Leases";
import { Maintenance, ShortStay } from "./pages/erp/Ops";
import Documents from "./pages/erp/Documents";
import { Tasks, Approvals, Reports, Users, Settings, Audit } from "./pages/erp/Admin";

const g = (m, el) => <Gate module={m}>{el}</Gate>;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/properties" element={<Catalogue />} />
            <Route path="/properties/:listingId" element={<PropertyDetail />} />
            <Route path="/services" element={<Services />} />
            <Route path="/services/:slug" element={<ServiceDetail />} />
            <Route path="/list-property" element={<ListProperty />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/legal/:slug" element={<Legal />} />
            <Route path="*" element={<div className="container-x py-24"><h1 className="font-heading text-2xl">Page not found</h1></div>} />
          </Route>
          <Route path="/erp/login" element={<Login />} />
          <Route path="/erp/reset-password" element={<ResetPassword />} />
          <Route path="/erp" element={<Protected><ErpLayout /></Protected>}>
            <Route index element={g("dashboard", <Dashboard />)} />
            <Route path="leads" element={g("leads", <Leads />)} />
            <Route path="leads/:id" element={g("leads", <LeadDetail />)} />
            <Route path="properties" element={g("properties", <Properties />)} />
            <Route path="properties/:id" element={g("properties", <ErpProperty />)} />
            <Route path="owners" element={g("owners", <Owners />)} />
            <Route path="deals" element={g("deals", <Deals />)} />
            <Route path="deals/:id" element={g("deals", <DealDetail />)} />
            <Route path="finance" element={g("finance", <Finance />)} />
            <Route path="leases" element={g("leases", <Leases />)} />
            <Route path="maintenance" element={g("maintenance", <Maintenance />)} />
            <Route path="short-stay" element={g("shortstay", <ShortStay />)} />
            <Route path="documents" element={g("documents", <Documents />)} />
            <Route path="tasks" element={g("tasks", <Tasks />)} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="reports" element={g("reports", <Reports />)} />
            <Route path="users" element={g("users", <Users />)} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit" element={g("audit", <Audit />)} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </AuthProvider>
  );
}
