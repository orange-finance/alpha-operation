const { main } = require("../src/main");

module.exports = async (req, res) => {
  try {
    await main.main();
    return res.status(200).send("Success");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error");
  }
};
