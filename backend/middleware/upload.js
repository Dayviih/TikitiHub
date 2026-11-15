const multer = require("multer");

// Store uploaded images temporarily in memory
const storage = multer.memoryStorage();

// Accept only supported image formats
function fileFilter(req, file, callback) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (allowedTypes.includes(file.mimetype)) {
    callback(null, true);
  } else {
    callback(new Error("Only JPG, PNG and WEBP images are allowed."));
  }
}

// Configure image uploads
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

upload.validateImage = function validateImageSignature(req, res, next) {
  if (!req.file) return next();
  const buffer = req.file.buffer;
  const mime = req.file.mimetype;
  const isJpeg = mime === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = mime === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = mime === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!isJpeg && !isPng && !isWebp) return res.status(400).json({ message: "Uploaded file content does not match a supported image type." });
  return next();
};

module.exports = upload;
