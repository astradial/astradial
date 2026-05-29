"use strict";

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const AUDIO_DIR = "/app/data/campaign-bot-audio";
const upload = multer({ dest: "/tmp", limits: { fileSize: 10 * 1024 * 1024 } });

try { fs.mkdirSync(AUDIO_DIR, { recursive: true }); } catch (_) {}

const { requirePermission } = require("../middleware/rbac");

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

router.post("/", requirePermission("campaigns.write"), async (req, res) => {
  try {
    const { CampaignBot } = require("../models");
    const { name, language, keywords, max_words, call_timeout, webhook_url } = req.body || {};
    if (!name || typeof name !== "string" || name.length > 200) {
      return res.status(400).json({ error: "name is required (1-200 chars)" });
    }
    const bot = await CampaignBot.create({
      org_id: req.orgId,
      name: name.trim(),
      language: language || "en",
      keywords: Array.isArray(keywords) ? keywords : [],
      max_words: Number.isInteger(max_words) && max_words > 0 ? max_words : 3,
      call_timeout: Number.isInteger(call_timeout) && call_timeout > 0 ? call_timeout : 8,
      webhook_url: webhook_url || null,
    });
    res.status(201).json(bot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/", requirePermission("campaigns.read"), async (req, res) => {
  try {
    const { CampaignBot } = require("../models");
    const { Op } = require("sequelize");
    const where = { org_id: req.orgId };
    if (req.query.q) {
      where.name = { [Op.like]: `%${req.query.q}%` };
    }
    const bots = await CampaignBot.findAll({ where, order: [["created_at", "DESC"]] });
    res.json({ data: bots, total: bots.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/:id", requirePermission("campaigns.read"), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid bot id" });
    const { CampaignBot } = require("../models");
    const bot = await CampaignBot.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    res.json(bot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/:id", requirePermission("campaigns.write"), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid bot id" });
    const { CampaignBot } = require("../models");
    const bot = await CampaignBot.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    const updates = {};
    if (req.body.name != null) updates.name = String(req.body.name).trim().slice(0, 200);
    if (req.body.language != null) updates.language = String(req.body.language).slice(0, 8);
    if (Array.isArray(req.body.keywords)) updates.keywords = req.body.keywords;
    if (req.body.max_words != null) updates.max_words = Math.max(1, Math.min(50, Number(req.body.max_words) || 3));
    if (req.body.call_timeout != null) updates.call_timeout = Math.max(1, Math.min(120, Number(req.body.call_timeout) || 8));
    if (req.body.webhook_url !== undefined) updates.webhook_url = req.body.webhook_url || null;
    await bot.update(updates);
    res.json(bot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/:id", requirePermission("campaigns.write"), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid bot id" });
    const { CampaignBot } = require("../models");
    const bot = await CampaignBot.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    if (bot.intro_audio_path) {
      try { fs.unlinkSync(bot.intro_audio_path); } catch (_) {}
    }
    await bot.destroy();
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/:id/upload-audio", requirePermission("campaigns.write"), upload.single("audio"), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "Invalid bot id" });
    if (!req.file) return res.status(400).json({ error: "No audio file uploaded. Use field name audio." });
    const { CampaignBot } = require("../models");
    const bot = await CampaignBot.findOne({ where: { id: req.params.id, org_id: req.orgId } });
    if (!bot) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ error: "Bot not found" });
    }
    if (bot.intro_audio_path) {
      try { fs.unlinkSync(bot.intro_audio_path); } catch (_) {}
    }
    const dest = path.join(AUDIO_DIR, `${bot.id}.mp3`);
    fs.renameSync(req.file.path, dest);
    await bot.update({ intro_audio_path: dest });
    res.json({ message: "Audio uploaded", path: dest });
  } catch (e) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
