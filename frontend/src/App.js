import { lazy, Suspense } from "react";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, Protected, OwnerOnly, InvestorOnly, Gate } from "./lib/auth";
import { DialogProvider } from "./lib/dialogs";
import { IS_DEMO } from "./lib/api";
import SiteLayout from "./components/public/SiteLayout";
import Home from "./pages/public/Home";
import Catalogue from "./pages/public/Catalogue";
import PropertyDetail from "./pages/public/PropertyDetail";
import ListProperty from "./pages/public/ListProperty";
import PlacePage from "./pages/public/Places";
import Shortlist from "./pages/public/Shortlist";
import { Insights, Article } from "./pages/public/Insights";
import { Services, ServiceDetail, About, Contact, Faq, Legal, Requirement, NotFound } from "./pages/public/Pages";
import { Login, ResetPassword } from "./pages/erp/Login";

// Staff and owner screens load on demand, so website visitors only download the public site.
const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const erp = () => import("./pages/erp/bundle");
const ErpLayout = lazy(() => import("./components/erp/ErpLayout"));
const Security = named(erp, "Security");
const ForcedSetup = named(erp, "ForcedSetup");
const Dashboard = named(erp, "Dashboard");
const Calendar = named(erp, "Calendar");
const Leads = named(erp, "Leads");
const LeadDetail = named(erp, "LeadDetail");
const Properties = named(erp, "Properties");
const ErpProperty = named(erp, "ErpProperty");
const Owners = named(erp, "Owners");
const Deals = named(erp, "Deals");
const DealDetail = named(erp, "DealDetail");
const Finance = named(erp, "Finance");
const Leases = named(erp, "Leases");
const Maintenance = named(erp, "Maintenance");
const ShortStay = named(erp, "StayDesk");
const Ceo = named(erp, "Ceo");
const Customers = named(erp, "Customers");
const CustomerDetail = named(erp, "CustomerDetail");
const AgreementsList = named(erp, "AgreementsList");
const AgreementEditor = named(erp, "AgreementEditor");
const InvestorsHome = named(erp, "InvestorsHome");
const InvestorDetail = named(erp, "InvestorDetail");
const ProjectDetail = named(erp, "ProjectDetail");
const WebsiteEditor = named(erp, "WebsiteEditor");
const Team = named(erp, "Team");
const Places = named(erp, "Places");
const Tools = named(erp, "Tools");
const Documents = named(erp, "Documents");
const InsightsList = named(erp, "InsightsList");
const InsightEditor = named(erp, "InsightEditor");
const Tasks = named(erp, "Tasks");
const Approvals = named(erp, "Approvals");
const Reports = named(erp, "Reports");
const Users = named(erp, "Users");
const Settings = named(erp, "Settings");
const Audit = named(erp, "Audit");
const owner = () => import("./pages/owner/OwnerPortal");
const OwnerLayout = named(owner, "OwnerLayout");
const OwnerOverview = named(owner, "OwnerOverview");
const OwnerRent = named(owner, "OwnerRent");
const OwnerStatements = named(owner, "OwnerStatements");
const OwnerRequests = named(owner, "OwnerRequests");
const OwnerStays = named(owner, "OwnerStays");
const OwnerDocuments = named(owner, "OwnerDocuments");
const investor = () => import("./pages/investor/InvestorPortal");
const InvestorLayout = named(investor, "InvestorLayout");
const InvestorOverview = named(investor, "InvestorOverview");
const InvestorHolding = named(investor, "InvestorHolding");
const InvestorPayouts = named(investor, "InvestorPayouts");
const InvestorUpdates = named(investor, "InvestorUpdates");
const InvestorDocuments = named(investor, "InvestorDocuments");
const Wait = () => <div className="flex min-h-[40vh] items-center justify-center p-10 text-sm text-slate-500">Loading…</div>;

const g = (m, el) => <Gate module={m}>{el}</Gate>;
// The hosted preview runs inside a single page, so it keeps the route after a "#".
const Router = IS_DEMO ? HashRouter : BrowserRouter;

export default function App({ children }) {
  return (
    <AuthProvider>
      <DialogProvider>
        <Router>
          <Suspense fallback={<Wait />}>
          <Routes>
            <Route element={<SiteLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/properties" element={<Catalogue />} />
              <Route path="/properties/:listingId" element={<PropertyDetail />} />
              <Route path="/services" element={<Services />} />
              <Route path="/services/:slug" element={<ServiceDetail />} />
              <Route path="/list-property" element={<ListProperty />} />
              <Route path="/properties-in/:city" element={<PlacePage />} />
              <Route path="/properties-in/:city/:locality" element={<PlacePage />} />
              <Route path="/shortlist" element={<Shortlist />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/insights/:slug" element={<Article />} />
              <Route path="/requirement" element={<Requirement />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/legal/:slug" element={<Legal />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="/erp/login" element={<Login />} />
            <Route path="/erp/reset-password" element={<ResetPassword />} />
            <Route path="/erp/setup-2-step" element={<Protected><ForcedSetup /></Protected>} />
            <Route path="/erp" element={<Protected><ErpLayout /></Protected>}>
              <Route index element={g("dashboard", <Dashboard />)} />
              <Route path="ceo" element={g("ceo", <Ceo />)} />
              <Route path="customers" element={g("customers", <Customers />)} />
              <Route path="customers/:id" element={g("customers", <CustomerDetail />)} />
              <Route path="agreements" element={g("agreements", <AgreementsList />)} />
              <Route path="agreements/new" element={g("agreements", <AgreementEditor />)} />
              <Route path="agreements/:id" element={g("agreements", <AgreementEditor />)} />
              <Route path="investors" element={g("investors", <InvestorsHome />)} />
              <Route path="investors/:id" element={g("investors", <InvestorDetail />)} />
              <Route path="inv-projects/:id" element={g("investors", <ProjectDetail />)} />
              <Route path="website" element={g("cms", <WebsiteEditor />)} />
              <Route path="team" element={<Team />} />
              <Route path="places" element={<Places />} />
              <Route path="tools" element={<Tools />} />
              <Route path="calendar" element={<Calendar />} />
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
              <Route path="insights" element={g("cms", <InsightsList />)} />
              <Route path="insights/:id" element={g("cms", <InsightEditor />)} />
              <Route path="tasks" element={g("tasks", <Tasks />)} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="reports" element={g("reports", <Reports />)} />
              <Route path="users" element={g("users", <Users />)} />
              <Route path="settings" element={<Settings />} />
              <Route path="security" element={<Security />} />
              <Route path="audit" element={g("audit", <Audit />)} />
              <Route path="*" element={<div className="p-10"><h2 className="font-heading text-xl">Page not found</h2></div>} />
            </Route>
            <Route path="/owner" element={<OwnerOnly><OwnerLayout /></OwnerOnly>}>
              <Route index element={<OwnerOverview />} />
              <Route path="rent" element={<OwnerRent />} />
              <Route path="statements" element={<OwnerStatements />} />
              <Route path="requests" element={<OwnerRequests />} />
              <Route path="stays" element={<OwnerStays />} />
              <Route path="documents" element={<OwnerDocuments />} />
            </Route>
            <Route path="/investor" element={<InvestorOnly><InvestorLayout /></InvestorOnly>}>
              <Route index element={<InvestorOverview />} />
              <Route path="holdings/:id" element={<InvestorHolding />} />
              <Route path="payouts" element={<InvestorPayouts />} />
              <Route path="updates" element={<InvestorUpdates />} />
              <Route path="documents" element={<InvestorDocuments />} />
            </Route>
          </Routes>
          </Suspense>
          {children}
        </Router>
        <Toaster position="bottom-right" />
      </DialogProvider>
    </AuthProvider>
  );
}
