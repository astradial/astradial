-- asterisk_cdr: standard Asterisk CDR table + seed matching the /calls/history filter
SET @org = 'd247b87d-5c25-4b80-89bb-9c0edc72ea04';
SET @prefix = 'org_mo3yhd1r_';

CREATE TABLE IF NOT EXISTS asterisk_cdr (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  calldate      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clid          VARCHAR(80)  NOT NULL DEFAULT '',
  src           VARCHAR(80)  NOT NULL DEFAULT '',
  dst           VARCHAR(80)  NOT NULL DEFAULT '',
  dcontext      VARCHAR(80)  NOT NULL DEFAULT '',
  channel       VARCHAR(80)  NOT NULL DEFAULT '',
  dstchannel    VARCHAR(80)  NOT NULL DEFAULT '',
  lastapp       VARCHAR(80)  NOT NULL DEFAULT '',
  lastdata      VARCHAR(80)  NOT NULL DEFAULT '',
  duration      INT          NOT NULL DEFAULT 0,
  billsec       INT          NOT NULL DEFAULT 0,
  disposition   VARCHAR(45)  NOT NULL DEFAULT '',
  amaflags      INT          NOT NULL DEFAULT 0,
  accountcode   VARCHAR(50)  NOT NULL DEFAULT '',
  uniqueid      VARCHAR(150) NOT NULL DEFAULT '',
  userfield     VARCHAR(255) NOT NULL DEFAULT '',
  peeraccount   VARCHAR(80)  NOT NULL DEFAULT '',
  linkedid      VARCHAR(150) NOT NULL DEFAULT '',
  sequence      INT          NOT NULL DEFAULT 1,
  recordingfile VARCHAR(255) NOT NULL DEFAULT '',
  INDEX idx_calldate (calldate),
  INDEX idx_linkedid (linkedid),
  INDEX idx_accountcode (accountcode),
  INDEX idx_peeraccount (peeraccount)
);

DELETE FROM asterisk_cdr WHERE accountcode = @org OR peeraccount = @org;

-- 30 CDR rows: mix of inbound queue, outbound direct, internal, and a couple with recordings
-- Filter requirements:
--   accountcode = orgId (our match)
--   channel NOT LIKE 'Local/%' (we use PJSIP/)
--   NOT (disposition='ANSWERED' AND billsec=0)
--   dst != 's'
--   dcontext: <prefix>_incoming | <prefix>_outbound | <prefix>_internal | ai-outbound

INSERT INTO asterisk_cdr (calldate, clid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, duration, billsec, disposition, accountcode, uniqueid, peeraccount, linkedid, recordingfile) VALUES
-- Inbound, answered, through Sales queue (most recent first)
(DATE_SUB(NOW(), INTERVAL  2 HOUR),  '"Customer 1" <+18005552001>', '+18005552001', '1001',  CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-00000001'), CONCAT('Local/2001@',@prefix,'internal'),  'Queue', CONCAT(@prefix,'sales_2001,tT,300'),  425, 410, 'ANSWERED',  @org, 'ast-00000001', @org, 'ast-00000001', ''),
(DATE_SUB(NOW(), INTERVAL  3 HOUR),  '"Customer 2" <+18005552002>', '+18005552002', '1001',  CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1002-00000002'), CONCAT('Local/2001@',@prefix,'internal'),  'Queue', CONCAT(@prefix,'sales_2001,tT,300'),  550, 525, 'ANSWERED',  @org, 'ast-00000002', @org, 'ast-00000002', ''),
(DATE_SUB(NOW(), INTERVAL  4 HOUR),  '"Customer 3" <+18005552003>', '+18005552003', '1002',  CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1003-00000003'), CONCAT('Local/2002@',@prefix,'internal'),  'Queue', CONCAT(@prefix,'support_2002,tT,300'),420, 410, 'ANSWERED',  @org, 'ast-00000003', @org, 'ast-00000003', ''),
-- Inbound, missed
(DATE_SUB(NOW(), INTERVAL  5 HOUR),  '"Customer 4" <+18005552004>', '+18005552004', '1001',  CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1004-00000004'), '', '', '',                                    30,   0, 'NO ANSWER', @org, 'ast-00000004', @org, 'ast-00000004', ''),
(DATE_SUB(NOW(), INTERVAL  6 HOUR),  '"Customer 5" <+18005552005>', '+18005552005', '1002',  CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1005-00000005'), '', '', '',                                     5,   0, 'BUSY',      @org, 'ast-00000005', @org, 'ast-00000005', ''),
-- Outbound, answered
(DATE_SUB(NOW(), INTERVAL  7 HOUR),  '"Alice J" <1001>',            '1001',         '+18005552006', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1001-00000006'), 'PJSIP/trunk-00000006','Dial','PJSIP/trunk/+18005552006', 300, 290, 'ANSWERED',  @org, 'ast-00000006', @org, 'ast-00000006', ''),
(DATE_SUB(NOW(), INTERVAL  8 HOUR),  '"Bob S" <1002>',              '1002',         '+18005552007', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1002-00000007'), 'PJSIP/trunk-00000007','Dial','PJSIP/trunk/+18005552007', 540, 525, 'ANSWERED',  @org, 'ast-00000007', @org, 'ast-00000007', ''),
(DATE_SUB(NOW(), INTERVAL  9 HOUR),  '"Carol W" <1003>',            '1003',         '+18005552008', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1003-00000008'), '',                    'Dial','PJSIP/trunk/+18005552008',  10,   0, 'FAILED',    @org, 'ast-00000008', @org, 'ast-00000008', ''),
-- Internal
(DATE_SUB(NOW(), INTERVAL 10 HOUR),  '"Alice J" <1001>',            '1001',         '1004', CONCAT(@prefix,'internal'), CONCAT('PJSIP/',@prefix,'1001-00000009'), CONCAT('PJSIP/',@prefix,'1004-00000009'),'Dial',CONCAT('PJSIP/',@prefix,'1004'),240, 235, 'ANSWERED', @org, 'ast-00000009', @org, 'ast-00000009', ''),
(DATE_SUB(NOW(), INTERVAL 11 HOUR),  '"Emma D" <1005>',             '1005',         '1006', CONCAT(@prefix,'internal'), CONCAT('PJSIP/',@prefix,'1005-0000000a'), CONCAT('PJSIP/',@prefix,'1006-0000000a'),'Dial',CONCAT('PJSIP/',@prefix,'1006'),180, 175, 'ANSWERED', @org, 'ast-0000000a', @org, 'ast-0000000a', ''),
-- More recent inbound
(DATE_SUB(NOW(), INTERVAL 12 HOUR), '"Customer 11" <+18005552011>',  '+18005552011','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-0000000b'), CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-0000000b', @org, 'ast-0000000b', ''),
(DATE_SUB(NOW(), INTERVAL 13 HOUR), '"Customer 12" <+18005552012>',  '+18005552012','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1002-0000000c'), CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-0000000c', @org, 'ast-0000000c', ''),
(DATE_SUB(NOW(), INTERVAL 14 HOUR), '"Customer 13" <+18005552013>',  '+18005552013','1002', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1003-0000000d'), CONCAT('Local/2002@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'support_2002,tT,300'),480, 465, 'ANSWERED', @org, 'ast-0000000d', @org, 'ast-0000000d', ''),
(DATE_SUB(NOW(), INTERVAL 15 HOUR), '"Customer 14" <+18005552014>',  '+18005552014','1003', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-0000000e'), CONCAT('PJSIP/',@prefix,'1001-0000000e'),'Dial',CONCAT('PJSIP/',@prefix,'1001'), 540, 530, 'ANSWERED', @org, 'ast-0000000e', @org, 'ast-0000000e', 'call_0000000e.wav'),
(DATE_SUB(NOW(), INTERVAL 16 HOUR), '"Customer 15" <+18005552015>',  '+18005552015','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1004-0000000f'), '', '', '',                                   8,   0, 'NO ANSWER', @org, 'ast-0000000f', @org, 'ast-0000000f', ''),
-- Day+ ago
(DATE_SUB(NOW(), INTERVAL  1 DAY),  '"Customer 16" <+18005552016>',  '+18005552016','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1002-00000010'),CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-00000010', @org, 'ast-00000010', ''),
(DATE_SUB(NOW(), INTERVAL  2 DAY),  '"Customer 17" <+18005552017>',  '+18005552017','1002', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1003-00000011'),CONCAT('Local/2002@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'support_2002,tT,300'),540, 525, 'ANSWERED', @org, 'ast-00000011', @org, 'ast-00000011', 'call_00000011.wav'),
(DATE_SUB(NOW(), INTERVAL  3 DAY),  '"Alice J" <1001>',              '1001','+18005552018', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1001-00000012'),'PJSIP/trunk-00000012','Dial','PJSIP/trunk/+18005552018', 540, 525, 'ANSWERED', @org, 'ast-00000012', @org, 'ast-00000012', ''),
(DATE_SUB(NOW(), INTERVAL  4 DAY),  '"Bob S" <1002>',                '1002','+18005552019', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1002-00000013'),'PJSIP/trunk-00000013','Dial','PJSIP/trunk/+18005552019', 540, 525, 'ANSWERED', @org, 'ast-00000013', @org, 'ast-00000013', ''),
(DATE_SUB(NOW(), INTERVAL  5 DAY),  '"Emma D" <1005>',               '1005','+918001002003', CONCAT(@prefix,'outbound'),CONCAT('PJSIP/',@prefix,'1005-00000014'),'PJSIP/trunk-00000014','Dial','PJSIP/trunk/+918001002003',1500,1475, 'ANSWERED', @org, 'ast-00000014', @org, 'ast-00000014', 'call_00000014.wav'),
(DATE_SUB(NOW(), INTERVAL  6 DAY),  '"Customer 21" <+18005552021>',  '+18005552021','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-00000015'),CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-00000015', @org, 'ast-00000015', ''),
(DATE_SUB(NOW(), INTERVAL  7 DAY),  '"Frank B" <1006>',              '1006','1001', CONCAT(@prefix,'internal'), CONCAT('PJSIP/',@prefix,'1006-00000016'),CONCAT('PJSIP/',@prefix,'1001-00000016'),'Dial',CONCAT('PJSIP/',@prefix,'1001'), 240, 235, 'ANSWERED', @org, 'ast-00000016', @org, 'ast-00000016', ''),
(DATE_SUB(NOW(), INTERVAL  8 DAY),  '"Customer 23" <+18005552023>',  '+18005552023','1002', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1003-00000017'),'', '', '',                                  30,   0, 'NO ANSWER', @org, 'ast-00000017', @org, 'ast-00000017', ''),
(DATE_SUB(NOW(), INTERVAL  9 DAY),  '"Customer 24" <+18005552024>',  '+18005552024','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-00000018'),CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-00000018', @org, 'ast-00000018', ''),
(DATE_SUB(NOW(), INTERVAL 10 DAY),  '"Customer 25" <+18005552025>',  '+18005552025','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1002-00000019'),CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-00000019', @org, 'ast-00000019', ''),
(DATE_SUB(NOW(), INTERVAL 11 DAY),  '"Customer 26" <+18005552026>',  '+18005552026','1002', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1003-0000001a'),CONCAT('Local/2002@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'support_2002,tT,300'),540, 525, 'ANSWERED', @org, 'ast-0000001a', @org, 'ast-0000001a', ''),
(DATE_SUB(NOW(), INTERVAL 12 DAY),  '"Alice J" <1001>',              '1001','+18005552027', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1001-0000001b'),'PJSIP/trunk-0000001b','Dial','PJSIP/trunk/+18005552027', 540, 525, 'ANSWERED', @org, 'ast-0000001b', @org, 'ast-0000001b', ''),
(DATE_SUB(NOW(), INTERVAL 13 DAY),  '"Bob S" <1002>',                '1002','+18005552028', CONCAT(@prefix,'outbound'), CONCAT('PJSIP/',@prefix,'1002-0000001c'),'',                    'Dial','PJSIP/trunk/+18005552028',  15,   0, 'CONGESTION',@org, 'ast-0000001c', @org, 'ast-0000001c', ''),
(DATE_SUB(NOW(), INTERVAL 14 DAY),  '"Dan L" <1004>',                '1004','1002', CONCAT(@prefix,'internal'), CONCAT('PJSIP/',@prefix,'1004-0000001d'),CONCAT('PJSIP/',@prefix,'1002-0000001d'),'Dial',CONCAT('PJSIP/',@prefix,'1002'), 240, 235, 'ANSWERED', @org, 'ast-0000001d', @org, 'ast-0000001d', ''),
(DATE_SUB(NOW(), INTERVAL 15 DAY),  '"Customer 30" <+18005552030>',  '+18005552030','1001', CONCAT(@prefix,'incoming'), CONCAT('PJSIP/',@prefix,'1001-0000001e'),CONCAT('Local/2001@',@prefix,'internal'), 'Queue', CONCAT(@prefix,'sales_2001,tT,300'), 540, 525, 'ANSWERED', @org, 'ast-0000001e', @org, 'ast-0000001e', '');

SELECT COUNT(*) AS cdr_rows FROM asterisk_cdr WHERE accountcode=@org;
SELECT direction, COUNT(*) n FROM (
  SELECT CASE
    WHEN dcontext LIKE '%incoming%' THEN 'inbound'
    WHEN dcontext LIKE '%outbound%' THEN 'outbound'
    WHEN dcontext LIKE '%internal%' THEN 'internal'
    ELSE 'other' END AS direction
  FROM asterisk_cdr WHERE accountcode=@org
) x GROUP BY direction;
