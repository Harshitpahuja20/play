const { responsestatusdata } = require("../middleware/responses");

const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #e6f0ff; /* Light blue background */
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    .message {
      font-size: 24px;
      font-weight: bold;
      color: #003366;
      text-align: center;
      padding: 20px;
      border-radius: 12px;
      background-color: #ffffff;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      max-width: 90%;
    }
  </style>
</head>
<body>
  <div class="message">Welcome to Win10 App</div>
</body>
</html>
`;

exports.getContent = async (req, res) => {
  return responsestatusdata(res, true, "Content fecthed successfully", content);
};
