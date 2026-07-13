import type { ErrorRequestHandler } from "express";

export const errorMiddleware: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = 500;
  const message = "Internal server error";
  console.error("Unhandled request error", {
    method: req.method,
    path: req.originalUrl,
    status,
    message,
  });
  res.status(status).json({
    message,
    code: "INTERNAL_SERVER_ERROR",
  });
};
