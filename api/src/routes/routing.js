const express = require('express'); const router = express.Router(); router.get('/', (req, res) => { res.json({ message: 'Routing endpoint - not implemented yet' }); }); module.exports = router;
