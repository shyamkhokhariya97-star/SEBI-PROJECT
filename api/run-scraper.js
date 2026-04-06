module.exports = (req, res) => {
  res.statusCode = 501;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      error:
        'Scraper execution is not supported on Vercel (serverless). Run `node raj.js` locally to generate new JSON files, then redeploy.'
    })
  );
};
