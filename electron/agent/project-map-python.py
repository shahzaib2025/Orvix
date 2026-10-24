import ast
import json
import pathlib
import re
import sys

try:
    source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig")
    tree = ast.parse(source)
    lines = source.splitlines()
    symbols, imports = [], []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            match = re.search(r"(?:async\s+)?(?:def|class)\s+(" + re.escape(node.name) + r")\b", lines[node.lineno - 1])
            symbols.append({"name": node.name, "kind": type(node).__name__, "line": node.lineno, "column": match.start(1) + 1 if match else node.col_offset + 1})
        elif isinstance(node, ast.Import):
            imports.extend({"specifier": alias.name, "level": 0} for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append({"specifier": node.module or "", "level": node.level})
    print(json.dumps({"symbols": symbols, "imports": imports, "resolution": "python-ast"}))
except Exception as exc:
    print(json.dumps({"symbols": [], "imports": [], "resolution": "unavailable", "diagnostic": str(exc)}))
