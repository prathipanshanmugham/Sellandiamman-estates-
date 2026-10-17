// Everything the staff workspace needs, loaded as one chunk after sign-in.
export { default as Security, ForcedSetup } from "./Security";
export { default as Dashboard } from "./Dashboard";
export { default as Calendar } from "./Calendar";
export { default as Leads } from "./Leads";
export { default as LeadDetail } from "./LeadDetail";
export { default as Properties } from "./Properties";
export { default as ErpProperty } from "./ErpProperty";
export { default as Owners } from "./Owners";
export { Deals, DealDetail } from "./Deals";
export { default as Finance } from "./Finance";
export { default as Leases } from "./Leases";
export { Maintenance, ShortStay } from "./Ops";
export { default as Documents } from "./Documents";
export { InsightsList, InsightEditor } from "./InsightsAdmin";
export { Tasks, Approvals, Reports, Users, Settings, Audit } from "./Admin";
