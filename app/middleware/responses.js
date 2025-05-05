// utils/responses.js

exports.responsestatusmessage = (res, status, message) => {
  return res.status(200).send({ status: status, message: message });
};

exports.responsestatusdata = (res, status, message, data) => {
  return res.status(200).send({ status: status, message: message, data: data });
};

exports.responsestatusdatatoken = (res, status, message, data, token) => {
  return res.status(200).send({
    status: status,
    message: message,
    data: data,
    token: token,
  });
};
