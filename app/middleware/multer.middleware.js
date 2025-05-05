const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Utility to generate a clean, unique filename
function generateCleanFileName(originalname, fieldname) {
  const dateStr = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const randomStr = crypto.randomBytes(3).toString("hex");
  const ext = path.extname(originalname);
  return `${fieldname}${dateStr}${randomStr}${ext}`;
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fieldName = file.fieldname;
    const uploadPath = path.join(__dirname, "../../public/uploads", fieldName);

    fs.mkdir(uploadPath, { recursive: true }, (err) => {
      if (err) return cb(err);
      cb(null, uploadPath);
    });
  },
  filename: (req, file, cb) => {
    const filename = generateCleanFileName(file.originalname, file.fieldname);
    file.generatedName = filename; // Store it in file object for controller use
    cb(null, filename);
  },
});

const upload = multer({ storage });
module.exports = upload;
