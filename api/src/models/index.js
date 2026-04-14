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

// CRM models
const CrmCompany = require('./CrmCompany')(sequelize);
const CrmContact = require('./CrmContact')(sequelize);
const CrmDeal = require('./CrmDeal')(sequelize);
const CrmActivity = require('./CrmActivity')(sequelize);
const CrmCustomField = require('./CrmCustomField')(sequelize);
const CrmCustomFieldValue = require('./CrmCustomFieldValue')(sequelize);
const CrmPipelineStage = require('./CrmPipelineStage')(sequelize);
const OrgApiKey = require('./OrgApiKey')(sequelize);

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
  testConnection,
  syncDatabase
};