import type { RequestHandler } from "express";

export const notFoundMiddleware: RequestHandler = (req, res) => {
  res.status(404).json({
    message: "Route not found",
    code: "ROUTE_NOT_FOUND",
    path: req.originalUrl,
  });
};
