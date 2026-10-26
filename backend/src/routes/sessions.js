const express = require("express");
const multer = require("multer");
const sessionService = require("../services/sessionService");
const historyService = require("../services/historyService");
const chatService = require("../services/chatService");
const documentService = require("../services/documentService");
const llmService = require("../services/llmService");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: documentService.MAX_FILE_BYTES, files: 1 } });

router.post("/", async (req, res, next) => {
  try {
    const { scenarioId } = req.body || {};
    if (!scenarioId) return res.status(400).json({ error: "scenarioId is required" });
    const result = await sessionService.startSession(req.user.id, scenarioId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// The caller's own interview history: ?q=&scenario=&status=&from=&to=&sort=date|score&order=&page=&limit=
// (must stay above "/:id" so "/" is not read as an id).
router.get("/", async (req, res, next) => {
  try {
    res.json(await historyService.searchHistory(req.user.id, req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    res.json({ session: await sessionService.getSession(req.user.id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/answer", async (req, res, next) => {
  try {
    const { answerText, inputMode } = req.body || {};
    const result = await sessionService.answerTurn(req.user.id, req.params.id, answerText, inputMode);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/finish", async (req, res, next) => {
  try {
    // Scoring (which also indexes the interview for the chat) and the short wait for model reviews
    // run side by side; the feedback is read again at the end so it includes reviews that landed
    // while scoring was still running.
    const waiting = sessionService.waitForCritiques(req.user.id, req.params.id).catch(() => {});
    await sessionService.finishSession(req.user.id, req.params.id);
    await waiting;
    const feedback = await sessionService.getFeedback(req.user.id, req.params.id);
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/feedback", async (req, res, next) => {
  try {
    res.json({ feedback: await sessionService.getFeedback(req.user.id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await sessionService.deleteSession(req.user.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/:id/prepare", async (req, res, next) => {
  try {
    res.json(await sessionService.prepareSession(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/documents", async (req, res, next) => {
  try {
    await sessionService.getOwnedSession(req.user.id, req.params.id);
    res.json({ documents: await documentService.listDocuments(req.user.id, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/documents", (req, res, next) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) return next(Object.assign(uploadError, { status: 400 }));
    try {
      const session = await sessionService.getOwnedSession(req.user.id, req.params.id);
      if (session.status !== "scored" && (session.status !== "in_progress" || session.turns.length)) {
        return res.status(400).json({ error: "upload documents before answering or after finishing the interview" });
      }
      if (session.preparedAt && session.status !== "scored") {
        return res.status(400).json({ error: "finish the interview before adding more documents" });
      }
      const document = await documentService.uploadDocument(req.user.id, req.params.id, req.file);
      res.status(201).json({ document });
    } catch (err) {
      next(err);
    }
  });
});

router.delete("/:id/documents/:documentId", async (req, res, next) => {
  try {
    const session = await sessionService.getOwnedSession(req.user.id, req.params.id);
    if (session.status !== "scored" &&
      (session.status !== "in_progress" || session.preparedAt || session.turns.length)) {
      return res.status(400).json({ error: "documents can be deleted before starting or after finishing the interview" });
    }
    await documentService.deleteDocument(req.user.id, req.params.id, req.params.documentId);
    await sessionService.removeDocumentContext(req.user.id, req.params.id, req.params.documentId);
    await sessionService.removeDocumentChatReferences(req.user.id, req.params.id, req.params.documentId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/chat", async (req, res, next) => {
  try {
    res.json({ messages: await chatService.getHistory(req.user.id, req.params.id), llm: llmService.status() });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/chat", async (req, res, next) => {
  try {
    const { message } = req.body || {};
    const messages = await chatService.postMessage(req.user.id, req.params.id, message);
    res.status(201).json({ messages, llm: llmService.status() });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/chat/stream", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    const messages = await chatService.streamMessage(req.user.id, req.params.id, req.body?.message, send, controller.signal);
    send({ type: "done", messages });
  } catch (error) {
    send({ type: "error", error: error.status && error.status < 500 ? error.message : "could not stream the reply" });
  } finally {
    res.end();
  }
});

module.exports = router;
