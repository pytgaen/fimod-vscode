"""Uppercase all string values."""

# fimod: input-format=lines
# fimod: output-format=lines

def transform(data, **_):
    return [row.upper() for row in data] if isinstance(data, list) else data.upper()
