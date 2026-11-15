
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Verify user authentication
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // Check whether token exists
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication required. Please provide a token."
      });
    }

    // Extract token
    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (!decoded.userId) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Load the current role so removed or demoted accounts lose access promptly.
    const user = await User.findById(decoded.userId).select("_id role tokenVersion isActive");

    if (!user || !user.isActive || decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = {
      userId: user._id.toString(),
      role: user.role
    };

    // Continue to the next middleware or route
    next();

  } catch (error) {
    if (error.name === "CastError" || error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return next(error);
  }
}

module.exports = authenticateToken;
