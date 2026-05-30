'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// 1. Stub the models index BEFORE requiring any of the services or routes.
const STUB = {
  CampaignLeadRun: {
    findOne: async () => null // We will override this per test
  },
  CampaignLead: {
    update: async () => ({}),
    findAll: async () => []
  },
  Campaign: {
    findByPk: async () => null // We will override this per test
  },
  CampaignEvent: {
    create: async () => ({}) // We will override this per test
  },
  sequelize: {
    transaction: async () => ({
      commit: async () => {},
      rollback: async () => {},
    }),
  },
  Op: {
    in: Symbol('in'),
    or: Symbol('or'),
    gte: Symbol('gte'),
  }
};

const modelsPath = path.resolve(__dirname, '../src/models/index.js');
require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: STUB,
};

// Now import the code we want to test
const { handleWhatsAppInboundReply } = require('../src/services/campaign-reply-handler');
const webhooksRouter = require('../src/routes/webhooks');

// Helper to mock request and response
function makeMockRes(callback) {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      if (callback) callback(null, this);
    },
    send(data) {
      this.body = data;
      if (callback) callback(null, this);
    }
  };
}

// Helper to get the /msg91-inbound handler from the router
const msg91Route = webhooksRouter.stack.find(
  (layer) => layer.route && layer.route.path === '/msg91-inbound'
);
const msg91Handler = msg91Route.route.stack[msg91Route.route.stack.length - 1].handle;

test('WhatsApp Webhook & Inbound Reply Handler Tests', async (t) => {

  t.beforeEach(() => {
    STUB.CampaignLeadRun.findOne = async () => null;
    STUB.CampaignLead.update = async () => ({});
    STUB.Campaign.findByPk = async () => null;
    STUB.CampaignEvent.create = async () => ({});
  });

  await t.test('1. contacted + keyword reply -> interested & run halted', async () => {
    let leadUpdatedStatus = null;
    let runUpdatedStatus = null;
    let eventCreated = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {
        runUpdatedStatus = data.status;
      }
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes', 'interested']
              }
            ]
          }
        ]
      }
    });

    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes');

    assert.equal(res.halted, 1);
    assert.equal(res.classified, 'interested');
    assert.equal(leadUpdatedStatus, 'interested');
    assert.equal(runUpdatedStatus, 'halted');
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.status_result, 'interested');
    assert.equal(eventCreated.payload.matched_keyword, 'yes');
  });

  await t.test('2. contacted + non-keyword reply -> engaged & run not halted', async () => {
    let leadUpdatedStatus = null;
    let runUpdatedStatus = null;
    let eventCreated = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {
        runUpdatedStatus = data.status;
      }
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes']
              }
            ]
          }
        ]
      }
    });

    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'hello');

    assert.equal(res.halted, 0);
    assert.equal(res.classified, 'engaged');
    assert.equal(leadUpdatedStatus, 'engaged');
    assert.equal(runUpdatedStatus, null);
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.status_result, 'engaged');
    assert.equal(eventCreated.payload.matched_keyword, null);
  });

  await t.test('3. engaged + keyword reply -> interested & run halted', async () => {
    let leadUpdatedStatus = null;
    let runUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'engaged',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {
        runUpdatedStatus = data.status;
      }
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes']
              }
            ]
          }
        ]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes');

    assert.equal(res.halted, 1);
    assert.equal(res.classified, 'interested');
    assert.equal(leadUpdatedStatus, 'interested');
    assert.equal(runUpdatedStatus, 'halted');
  });

  await t.test('4. interested + non-keyword reply does not downgrade', async () => {
    let leadUpdatedStatus = null;
    let runUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'interested',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {
        runUpdatedStatus = data.status;
      }
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes']
              }
            ]
          }
        ]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'hello');

    assert.equal(res.halted, 0);
    assert.equal(res.classified, 'interested');
    assert.equal(leadUpdatedStatus, null); // should not call lead.update
    assert.equal(runUpdatedStatus, null);
  });

  await t.test('5. qualified reply does not downgrade', async () => {
    let leadUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'qualified',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes']
              }
            ]
          }
        ]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes');

    assert.equal(res.classified, 'qualified');
    assert.equal(leadUpdatedStatus, null);
  });

  await t.test('6. yes does not match yesterday', async () => {
    let leadUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes']
              }
            ]
          }
        ]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yesterday');

    assert.equal(res.classified, 'engaged'); // non-keyword match moves contacted to engaged
    assert.equal(leadUpdatedStatus, 'engaged');
  });

  await t.test('7. Multi-word keyword matches correctly', async () => {
    let leadUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async (data) => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [
          {
            actions: [
              {
                type: 'whatsapp',
                interest_keywords: ['yes interested']
              }
            ]
          }
        ]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes interested, send details');

    assert.equal(res.classified, 'interested');
    assert.equal(leadUpdatedStatus, 'interested');
  });

  await t.test('8. whatsapp_replied Activity event is created for keyword reply', async () => {
    let eventCreated = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async () => {}
      },
      update: async () => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });

    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    await handleWhatsAppInboundReply('org-1', '919876543210', 'yes');

    assert.ok(eventCreated);
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.direction, 'inbound');
    assert.equal(eventCreated.payload.matched_keyword, 'yes');
  });

  await t.test('9. whatsapp_replied Activity event is created for non-keyword reply', async () => {
    let eventCreated = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async () => {}
      },
      update: async () => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });

    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    await handleWhatsAppInboundReply('org-1', '919876543210', 'hello');

    assert.ok(eventCreated);
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.direction, 'inbound');
    assert.equal(eventCreated.payload.matched_keyword, null);
  });

  await t.test('10. Duplicate webhook does not duplicate Activity event', async () => {
    let eventCount = 0;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async () => {}
      },
      update: async () => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });

    STUB.CampaignEvent.create = async () => {
      eventCount++;
      if (eventCount > 1) {
        const err = new Error('Unique constraint error');
        err.name = 'SequelizeUniqueConstraintError';
        throw err;
      }
      return {};
    };

    // First call
    const res1 = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes', 'msg-100');
    // Second call (duplicate)
    const res2 = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes', 'msg-100');

    assert.equal(eventCount, 2); // Attempted twice
    assert.equal(res1.classified, 'interested');
    assert.equal(res2.classified, 'contacted'); // duplicate is skipped, returns current status (contacted before first transaction committed, or contacted on rollback)
  });

  await t.test('11. Completed run can still be matched', async () => {
    let leadUpdatedStatus = null;

    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'completed',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async () => {}
    });

    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });

    const res = await handleWhatsAppInboundReply('org-1', '919876543210', 'yes');

    assert.equal(res.halted, 0); // already completed run is not halted again
    assert.equal(res.classified, 'interested');
    assert.equal(leadUpdatedStatus, 'interested');
  });

  await t.test('12. Unknown phone number does not update any lead', async () => {
    STUB.CampaignLeadRun.findOne = async () => null;

    const res = await handleWhatsAppInboundReply('org-1', '919999999999', 'yes');

    assert.equal(res.halted, 0);
    assert.equal(res.classified, null);
  });

  await t.test('13. Webhook: Delivery callback with phone + status: delivered + no text is ignored', async () => {
    let findAllCalled = false;
    let eventCreated = false;
    let leadUpdated = false;

    STUB.CampaignLead.findAll = async () => {
      findAllCalled = true;
      return [{ org_id: 'org-1' }];
    };
    STUB.CampaignEvent.create = async () => {
      eventCreated = true;
      return {};
    };
    STUB.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    const req = {
      body: {
        customerNumber: '919876543210',
        status: 'delivered',
        messageId: 'delivery-test-1'
      }
    };

    let resBody = null;
    const res = makeMockRes((err, response) => {
      resBody = response.body;
    });

    await msg91Handler(req, res);

    assert.equal(findAllCalled, false);
    assert.equal(eventCreated, false);
    assert.equal(leadUpdated, false);
    assert.deepEqual(resBody, { received: true, ignored: true, reason: 'not_customer_reply' });
  });

  await t.test('14. Webhook: Read callback is ignored and does not move status or log activity', async () => {
    let findAllCalled = false;
    let eventCreated = false;
    let leadUpdated = false;

    STUB.CampaignLead.findAll = async () => {
      findAllCalled = true;
      return [{ org_id: 'org-1' }];
    };
    STUB.CampaignEvent.create = async () => {
      eventCreated = true;
      return {};
    };
    STUB.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    const req = {
      body: {
        from: '919876543210',
        eventName: 'read',
        messageId: 'read-test-1'
      }
    };

    let resBody = null;
    const res = makeMockRes((err, response) => {
      resBody = response.body;
    });

    await msg91Handler(req, res);

    assert.equal(findAllCalled, false);
    assert.equal(eventCreated, false);
    assert.equal(leadUpdated, false);
    assert.deepEqual(resBody, { received: true, ignored: true, reason: 'not_customer_reply' });
  });

  await t.test('15. Webhook: Failed/sent/submitted callbacks are ignored', async () => {
    const statuses = ['failed', 'sent', 'submitted'];
    for (const status of statuses) {
      let findAllCalled = false;
      let eventCreated = false;
      let leadUpdated = false;

      STUB.CampaignLead.findAll = async () => {
        findAllCalled = true;
        return [{ org_id: 'org-1' }];
      };
      STUB.CampaignEvent.create = async () => {
        eventCreated = true;
        return {};
      };
      STUB.CampaignLead.update = async () => {
        leadUpdated = true;
        return {};
      };

      const req = {
        body: {
          from: '919876543210',
          status,
          messageId: 'test-1'
        }
      };

      let resBody = null;
      const res = makeMockRes((err, response) => {
        resBody = response.body;
      });

      await msg91Handler(req, res);

      assert.equal(findAllCalled, false);
      assert.equal(eventCreated, false);
      assert.equal(leadUpdated, false);
      assert.deepEqual(resBody, { received: true, ignored: true, reason: 'not_customer_reply' });
    }
  });

  await t.test('16. Webhook: Empty text callback is ignored', async () => {
    let findAllCalled = false;
    let eventCreated = false;
    let leadUpdated = false;

    STUB.CampaignLead.findAll = async () => {
      findAllCalled = true;
      return [{ org_id: 'org-1' }];
    };
    STUB.CampaignEvent.create = async () => {
      eventCreated = true;
      return {};
    };
    STUB.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    const req = {
      body: {
        from: '919876543210',
        text: '   ',
        messageId: 'empty-test-1'
      }
    };

    let resBody = null;
    const res = makeMockRes((err, response) => {
      resBody = response.body;
    });

    await msg91Handler(req, res);

    assert.equal(findAllCalled, false);
    assert.equal(eventCreated, false);
    assert.equal(leadUpdated, false);
    assert.deepEqual(resBody, { received: true, ignored: true, reason: 'not_customer_reply' });
  });

  await t.test('17. Webhook: Actual non-keyword reply moves contacted -> engaged', async () => {
    let leadUpdatedStatus = null;
    let eventCreated = null;

    STUB.CampaignLead.findAll = async () => {
      return [{ org_id: 'org-1' }];
    };
    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async () => {}
    });
    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });
    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    const req = {
      body: {
        from: '919876543210',
        text: 'hello customer reply',
        messageId: 'reply-test-1'
      }
    };

    let resBody = null;
    const res = makeMockRes((err, response) => {
      resBody = response.body;
    });

    await msg91Handler(req, res);

    assert.deepEqual(resBody, { received: true });
    assert.equal(leadUpdatedStatus, 'engaged');
    assert.ok(eventCreated);
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.status_result, 'engaged');
  });

  await t.test('18. Webhook: Actual keyword reply moves contacted -> interested', async () => {
    let leadUpdatedStatus = null;
    let eventCreated = null;

    STUB.CampaignLead.findAll = async () => {
      return [{ org_id: 'org-1' }];
    };
    STUB.CampaignLeadRun.findOne = async () => ({
      id: 'run-123',
      status: 'waiting',
      lead: {
        id: 'lead-123',
        campaign_id: 'campaign-123',
        status: 'contacted',
        update: async (data) => {
          leadUpdatedStatus = data.status;
        }
      },
      update: async () => {}
    });
    STUB.Campaign.findByPk = async () => ({
      id: 'campaign-123',
      template_snapshot: {
        days: [{ actions: [{ type: 'whatsapp', interest_keywords: ['yes'] }] }]
      }
    });
    STUB.CampaignEvent.create = async (data) => {
      eventCreated = data;
      return {};
    };

    const req = {
      body: {
        from: '919876543210',
        text: 'yes',
        messageId: 'reply-test-2'
      }
    };

    let resBody = null;
    const res = makeMockRes((err, response) => {
      resBody = response.body;
    });

    await msg91Handler(req, res);

    assert.deepEqual(resBody, { received: true });
    assert.equal(leadUpdatedStatus, 'interested');
    assert.ok(eventCreated);
    assert.equal(eventCreated.kind, 'whatsapp_replied');
    assert.equal(eventCreated.payload.status_result, 'interested');
  });

});
