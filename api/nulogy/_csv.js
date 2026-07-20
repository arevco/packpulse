export function parseCSV(text) {
  var lines = String(text || "").split("\n");
  if (lines.length < 2) return [];

  var headers = parseCSVLine(lines[0]);
  var rows = [];

  for (var i = 1; i < lines.length; i += 1) {
    var line = String(lines[i] || "").trim();
    if (!line) continue;
    var values = parseCSVLine(line);
    var row = {};
    headers.forEach(function(header, index) {
      row[header] = index < values.length ? values[index] : "";
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line) {
  var result = [];
  var current = "";
  var inQuotes = false;

  for (var i = 0; i < line.length; i += 1) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (i + 1 < line.length && line[i + 1] === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}
