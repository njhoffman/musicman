const queries = require('./queries');

module.exports = db => {
  const getColumns = async () => {
    const columnsQuery = queries.columns();
    const { rows: columns } = await db.query(columnsQuery);
    return columns;
  };

  return {
    getColumns
  };
};
