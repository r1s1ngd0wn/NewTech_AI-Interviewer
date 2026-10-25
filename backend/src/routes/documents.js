const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const documentService = require("../services/documentService");
const sessionService = require("../services/sessionService");

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: documentService.MAX_FILE_BYTES, files: 1 } });

router.get("/", async (req, res, next) => {
  try {
    res.json({ documents: await documentService.listUserDocuments(req.user.id) });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    res.json({ document: await documentService.getUserDocument(req.user.id, req.params.id) });
  } catch (error) { next(error); }
});

router.post("/", (req, res, next) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) return next(Object.assign(uploadError, { status: 400 }));
    try {
      const document = await documentService.uploadUserDocument(req.user.id, req.body?.kind, req.file);
      res.status(201).json({ document });
    } catch (error) { next(error); }
  });
});

router.delete("/:id", async (req, res, next) => {
  try {
    await documentService.deleteUserDocument(req.user.id, req.params.id);
    for (const session of await sessionService.listSessionsForUser(req.user.id)) {
      await sessionService.removeDocumentContext(req.user.id, session.id, req.params.id);
      await sessionService.removeDocumentChatReferences(req.user.id, session.id, req.params.id);
    }
    res.status(204).end();
  } catch (error) { next(error); }
});

module.exports = router;
