const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

// Import models
const Organization = require('./Organization')(sequelize);
const SipTrunk = require('./SipTrunk')(sequelize);
const DidNumber = require('./DidNumber')(sequelize);
const User = require('./User')(sequelize);
const Queue = require('./Queue')(sequelize);
const QueueMember = require('./QueueMember')(sequelize);
const Webhook = require('./Webhook')(sequelize);
const CallRecord = require('./CallRecord')(sequelize);
const RoutingRule = require('./RoutingRule')(sequelize);
const Ivr = require('./Ivr')(sequelize);
const IvrMenu = require('./IvrMenu')(sequelize);
const OutboundRoute = require('./OutboundRoute')(sequelize);
const GlobalSettings = require('./GlobalSettings')(sequelize);
const Greeting = require('./Greeting')(sequelize);
const CustomerTunnel = require('./CustomerTunnel')(sequelize);
const TunnelMetric = require('./TunnelMetric')(sequelize);
const TicketAlertSubscriber = require('./TicketAlertSubscriber')(sequelize);
const Ticket = require('./Ticket')(sequelize);
const TicketCallEvent = require('./TicketCallEvent')(sequelize);
const AdminWhatsappConfig = require('./AdminWhatsappConfig')(sequelize);

// CRM models
const CrmCompany = require('./CrmCompany')(sequelize);
const CrmContact = require('./CrmContact')(sequelize);
const CrmDeal = require('./CrmDeal')(sequelize);
const CrmActivity = require('./CrmActivity')(sequelize);
const CrmCustomField = require('./CrmCustomField')(sequelize);
const CrmCustomFieldValue = require('./CrmCustomFieldValue')(sequelize);
const CrmPipelineStage = require('./CrmPipelineStage')(sequelize);
const OrgApiKey = require('./OrgApiKey')(sequelize);

// Campaigns models
const CampaignTemplate = require('./CampaignTemplate')(sequelize);
const Campaign = require('./Campaign')(sequelize);
const CampaignLead = require('./CampaignLead')(sequelize);
const CampaignLeadRun = require('./CampaignLeadRun')(sequelize);
const CampaignEvent = require('./CampaignEvent')(sequelize);
const CampaignLeadField = require('./CampaignLeadField')(sequelize);
const CampaignApproval = require('./CampaignApproval')(sequelize);
const CampaignImportJob = require('./CampaignImportJob')(sequelize);
const CampaignBot = require('./CampaignBot')(sequelize);

// Define associations
// Organization relationships
Organization.hasMany(SipTrunk, { foreignKey: 'org_id', as: 'trunks' });
Organization.hasMany(DidNumber, { foreignKey: 'org_id', as: 'dids' });
Organization.hasMany(User, { foreignKey: 'org_id', as: 'users' });
Organization.hasMany(Queue, { foreignKey: 'org_id', as: 'queues' });
Organization.hasMany(Webhook, { foreignKey: 'org_id', as: 'webhooks' });
Organization.hasMany(CallRecord, { foreignKey: 'org_id', as: 'callRecords' });
Organization.hasMany(RoutingRule, { foreignKey: 'org_id', as: 'routingRules' });
Organization.hasMany(Ivr, { foreignKey: 'org_id', as: 'ivrs' });
Organization.hasMany(OutboundRoute, { foreignKey: 'org_id', as: 'outboundRoutes' });
Organization.hasMany(Greeting, { foreignKey: 'org_id', as: 'greetings' });
Organization.hasMany(CustomerTunnel, { foreignKey: 'org_id', as: 'customerTunnels' });
Organization.hasMany(TicketAlertSubscriber, { foreignKey: 'org_id', as: 'ticketAlertSubscribers' });
TicketAlertSubscriber.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

// Tickets — relational replacement for Firestore tickets collection.
// CASCADE on org delete (org cleanup wipes its tickets). assignee
// FK is `constraints: false` so deleting a user doesn't try to cascade
// into tickets and only nulls the assignee softly via app code.
Organization.hasMany(Ticket, { foreignKey: 'org_id', as: 'tickets' });
Ticket.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Ticket.belongsTo(User, { foreignKey: 'assignee_user_id', as: 'assignee', constraints: false });

// TicketCallEvent — append-only timeline of call attempts per ticket.
// CASCADE on ticket delete so events vanish with their parent during
// the lazy archive→delete sweep (Ticket.sweepArchive).
Ticket.hasMany(TicketCallEvent, { foreignKey: 'ticket_id', as: 'callEvents' });
TicketCallEvent.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });

// CustomerTunnel relationships
CustomerTunnel.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CustomerTunnel.hasMany(TunnelMetric, { foreignKey: 'tunnel_id', as: 'metrics' });
TunnelMetric.belongsTo(CustomerTunnel, { foreignKey: 'tunnel_id', as: 'tunnel' });

// SipTrunk relationships
SipTrunk.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
SipTrunk.hasMany(DidNumber, { foreignKey: 'trunk_id', as: 'dids' });
SipTrunk.hasMany(CallRecord, { foreignKey: 'trunk_id', as: 'callRecords' });
SipTrunk.hasMany(OutboundRoute, { foreignKey: 'trunk_id', as: 'outboundRoutes' });

// DidNumber relationships
DidNumber.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
DidNumber.belongsTo(SipTrunk, { foreignKey: 'trunk_id', as: 'trunk' });
DidNumber.belongsTo(RoutingRule, { foreignKey: 'routing_rule_id', as: 'routingRule' });

// User relationships
User.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
User.hasMany(QueueMember, { foreignKey: 'user_id', as: 'queueMemberships' });
User.hasMany(CallRecord, { foreignKey: 'user_id', as: 'callRecords' });

// Queue relationships
Queue.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Queue.hasMany(QueueMember, { foreignKey: 'queue_id', as: 'members' });
Queue.hasMany(CallRecord, { foreignKey: 'queue_id', as: 'callRecords' });

// QueueMember relationships
QueueMember.belongsTo(Queue, { foreignKey: 'queue_id', as: 'queue' });
QueueMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Webhook relationships
Webhook.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

// CallRecord relationships
CallRecord.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CallRecord.belongsTo(Queue, { foreignKey: 'queue_id', as: 'queue' });
CallRecord.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
CallRecord.belongsTo(SipTrunk, { foreignKey: 'trunk_id', as: 'trunk' });

// RoutingRule relationships
RoutingRule.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
RoutingRule.hasMany(DidNumber, { foreignKey: 'routing_rule_id', as: 'dids' });

// IVR relationships
Ivr.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Ivr.hasMany(IvrMenu, { foreignKey: 'ivr_id', as: 'menuOptions' });

// IVR Menu relationships
IvrMenu.belongsTo(Ivr, { foreignKey: 'ivr_id', as: 'ivr' });

// Outbound Route relationships
OutboundRoute.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
OutboundRoute.belongsTo(SipTrunk, { foreignKey: 'trunk_id', as: 'trunk' });

// Greeting relationships
Greeting.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Queue.belongsTo(Greeting, { foreignKey: 'greeting_id', as: 'greeting' });

// CRM relationships
Organization.hasMany(CrmCompany, { foreignKey: 'org_id', as: 'crmCompanies' });
Organization.hasMany(CrmContact, { foreignKey: 'org_id', as: 'crmContacts' });
Organization.hasMany(CrmDeal, { foreignKey: 'org_id', as: 'crmDeals' });
Organization.hasMany(CrmActivity, { foreignKey: 'org_id', as: 'crmActivities' });
Organization.hasMany(CrmCustomField, { foreignKey: 'org_id', as: 'crmCustomFields' });

CrmCompany.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CrmCompany.hasMany(CrmContact, { foreignKey: 'company_id', as: 'contacts' });
CrmCompany.hasMany(CrmDeal, { foreignKey: 'company_id', as: 'deals' });
CrmCompany.hasMany(CrmActivity, { foreignKey: 'company_id', as: 'activities' });

CrmContact.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CrmContact.belongsTo(CrmCompany, { foreignKey: 'company_id', as: 'company' });
CrmContact.hasMany(CrmDeal, { foreignKey: 'contact_id', as: 'deals' });
CrmContact.hasMany(CrmActivity, { foreignKey: 'contact_id', as: 'activities' });

CrmDeal.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CrmDeal.belongsTo(CrmCompany, { foreignKey: 'company_id', as: 'company' });
CrmDeal.belongsTo(CrmContact, { foreignKey: 'contact_id', as: 'contact' });
CrmDeal.hasMany(CrmActivity, { foreignKey: 'deal_id', as: 'activities' });

CrmActivity.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CrmActivity.belongsTo(CrmContact, { foreignKey: 'contact_id', as: 'contact' });
CrmActivity.belongsTo(CrmCompany, { foreignKey: 'company_id', as: 'company' });
CrmActivity.belongsTo(CrmDeal, { foreignKey: 'deal_id', as: 'deal' });

CrmCustomField.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CrmCustomField.hasMany(CrmCustomFieldValue, { foreignKey: 'field_id', as: 'values' });
CrmCustomFieldValue.belongsTo(CrmCustomField, { foreignKey: 'field_id', as: 'field' });

Organization.hasMany(CrmPipelineStage, { foreignKey: 'org_id', as: 'crmPipelineStages' });
CrmPipelineStage.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

Organization.hasMany(OrgApiKey, { foreignKey: 'org_id', as: 'apiKeys' });
OrgApiKey.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

// Campaigns associations
Organization.hasMany(CampaignTemplate, { foreignKey: 'org_id', as: 'campaignTemplates' });
CampaignTemplate.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
CampaignTemplate.hasMany(Campaign, { foreignKey: 'template_id', as: 'campaigns' });

Organization.hasMany(Campaign, { foreignKey: 'org_id', as: 'campaigns' });
Campaign.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Campaign.belongsTo(CampaignTemplate, { foreignKey: 'template_id', as: 'template' });
Campaign.hasMany(CampaignLead, { foreignKey: 'campaign_id', as: 'leads' });
Campaign.hasMany(CampaignLeadRun, { foreignKey: 'campaign_id', as: 'runs' });
Campaign.hasMany(CampaignEvent, { foreignKey: 'campaign_id', as: 'events' });
Campaign.hasMany(CampaignApproval, { foreignKey: 'campaign_id', as: 'approvals' });

CampaignLead.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
CampaignLead.belongsTo(CrmContact, { foreignKey: 'crm_contact_id', as: 'crmContact', constraints: false });
CampaignLead.hasOne(CampaignLeadRun, { foreignKey: 'campaign_lead_id', as: 'run' });
CampaignLead.hasMany(CampaignEvent, { foreignKey: 'campaign_lead_id', as: 'events' });

CampaignLeadRun.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
CampaignLeadRun.belongsTo(CampaignLead, { foreignKey: 'campaign_lead_id', as: 'lead' });

CampaignEvent.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
CampaignEvent.belongsTo(CampaignLead, { foreignKey: 'campaign_lead_id', as: 'lead' });

Organization.hasMany(CampaignLeadField, { foreignKey: 'org_id', as: 'campaignLeadFields' });
CampaignLeadField.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

CampaignApproval.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
CampaignApproval.belongsTo(CampaignLead, { foreignKey: 'campaign_lead_id', as: 'lead' });

// Async-import job tracking — one row per /leads/import-async call.
Campaign.hasMany(CampaignImportJob, { foreignKey: 'campaign_id', as: 'importJobs' });
CampaignImportJob.belongsTo(Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
CampaignImportJob.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });
Organization.hasMany(CampaignBot, { foreignKey: 'org_id', as: 'campaignBots' });
CampaignBot.belongsTo(Organization, { foreignKey: 'org_id', as: 'organization' });

// Database connection test
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✓ Database connection established successfully');
  } catch (error) {
    console.error('✗ Unable to connect to database:', error);
  }
};

// Sync database
const syncDatabase = async (force = false) => {
  try {
    await sequelize.sync({ force });
    console.log('✓ Database synchronized successfully');
  } catch (error) {
    console.error('✗ Failed to sync database:', error);
  }
};

module.exports = {
  sequelize,
  Organization,
  SipTrunk,
  DidNumber,
  User,
  Queue,
  QueueMember,
  Webhook,
  CallRecord,
  RoutingRule,
  Ivr,
  IvrMenu,
  OutboundRoute,
  GlobalSettings,
  Greeting,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmActivity,
  CrmCustomField,
  CrmCustomFieldValue,
  CrmPipelineStage,
  OrgApiKey,
  CustomerTunnel,
  TunnelMetric,
  TicketAlertSubscriber,
  Ticket,
  TicketCallEvent,
  AdminWhatsappConfig,
  CampaignTemplate,
  Campaign,
  CampaignLead,
  CampaignLeadRun,
  CampaignEvent,
  CampaignLeadField,
  CampaignApproval,
  CampaignImportJob,
  CampaignBot,
  testConnection,
  syncDatabase
};