"""Bounded, syntax-aware Python navigation. Project files are parsed, never executed."""

import ast
import json
import os
import re
import sys
import tokenize

MAX_FILES = 1200
MAX_BYTES = 512_000
IGNORED = {".git", ".venv", "venv", "__pycache__", "node_modules", "dist", "build", "release", "coverage", ".cache", ".mypy_cache", ".pytest_cache", ".ssh", ".aws", ".gnupg", ".config"}


def inside(root, target):
    try:
        return os.path.commonpath([root, os.path.realpath(target)]) == root
    except ValueError:
        return False


def module_name(root, file):
    relative = os.path.relpath(file, root).replace(os.sep, ".")
    if relative.endswith(".__init__.py"):
        return relative[: -len(".__init__.py")]
    return relative[:-3] if relative.endswith(".py") else relative


def location(file, line, column, text, **extra):
    return {"file": file, "line": line, "column": column, "text": text[:260], **extra}


class Index(ast.NodeVisitor):
    def __init__(self, file, module, lines):
        self.file, self.module, self.lines = file, module, lines
        self.scope = []
        self.definitions, self.references, self.callers, self.imports = [], [], [], []

    def text(self, line):
        return self.lines[line - 1].rstrip("\r\n") if 0 < line <= len(self.lines) else ""

    def place(self, node, **extra):
        return location(self.file, node.lineno, node.col_offset + 1, self.text(node.lineno), **extra)

    def declaration(self, node, name, kind):
        source_line = self.text(node.lineno)
        start = source_line.find(name, node.col_offset)
        column = start + 1 if start >= 0 else node.col_offset + 1
        return location(self.file, node.lineno, column, source_line, name=name, kind=kind, scope=".".join(self.scope))

    def visit_FunctionDef(self, node):
        self.definitions.append(self.declaration(node, node.name, "function"))
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.definitions.append(self.declaration(node, node.name, "class"))
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append(self.place(node, module=alias.name, names=[alias.asname or alias.name.split(".")[0]]))

    def visit_ImportFrom(self, node):
        package = self.module if os.path.basename(self.file) == "__init__.py" else self.module.rpartition(".")[0]
        parts = package.split(".")[:1 - node.level] if node.level > 1 else package.split(".")
        target = ".".join([*parts, node.module or ""]).strip(".") if node.level else node.module or ""
        self.imports.append(self.place(node, module=target, names=[alias.name for alias in node.names]))

    def visit_Name(self, node):
        self.references.append(self.place(node, name=node.id, scope=".".join(self.scope), kind="name"))

    def visit_Attribute(self, node):
        column = node.end_col_offset - len(node.attr) + 1 if node.end_col_offset else node.col_offset + 1
        self.references.append(location(self.file, node.end_lineno or node.lineno, column,
                                        self.text(node.end_lineno or node.lineno), name=node.attr,
                                        scope=".".join(self.scope), kind="attribute"))
        self.generic_visit(node)

    def visit_Call(self, node):
        name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else None
        if name:
            self.callers.append(self.place(node, name=name, enclosingSymbol=".".join(self.scope) or "<module>"))
        self.generic_visit(node)


def scan(root, selected):
    indexed = []
    truncated = False
    def include(file):
        if not inside(root, file) or os.path.getsize(file) > MAX_BYTES:
            return False
        with tokenize.open(file) as stream:
            source = stream.read()
        tree = ast.parse(source, filename=file)
        item = Index(file, module_name(root, file), source.splitlines(keepends=True))
        item.visit(tree)
        indexed.append(item)
        return True
    if not include(selected):
        raise ValueError("This Python file exceeds the navigation size limit.")
    for directory, names, files in os.walk(root, followlinks=False):
        names[:] = sorted(name for name in names if name.lower() not in IGNORED and not name.startswith("."))
        for name in sorted(files):
            if not name.endswith(".py") or os.path.normcase(os.path.join(directory, name)) == os.path.normcase(selected):
                continue
            if len(indexed) >= MAX_FILES:
                return indexed, True
            file = os.path.join(directory, name)
            try:
                if not include(file):
                    truncated = True
            except (OSError, UnicodeError, SyntaxError, ValueError):
                continue
    return indexed, truncated


def run(payload):
    root = os.path.realpath(payload["root"])
    file = os.path.realpath(payload["file"])
    action = payload["action"]
    if not inside(root, file) or not file.endswith(".py"):
        raise ValueError("Python file is outside the open project.")
    with tokenize.open(file) as stream:
        source = stream.read()
    lines = source.splitlines()
    base = {"engine": "python_ast", "confidence": "syntax_aware_candidates", "project": root,
            "file": file, "action": action,
            "warnings": ["Python imports, dynamic dispatch, and same-named symbols can make cross-file results ambiguous. Re-read candidate files before editing."]}
    try:
        ast.parse(source, filename=file)
    except SyntaxError as error:
        diagnostic = location(file, error.lineno or 1, error.offset or 1,
                              lines[(error.lineno or 1) - 1] if 0 < (error.lineno or 0) <= len(lines) else "",
                              severity="error", message=error.msg)
        if action == "diagnostics":
            return {**base, "results": [diagnostic], "truncated": False}
        return {**base, "results": [], "warnings": [*base["warnings"], "This file has a syntax error; navigation is incomplete."], "truncated": False}
    if action == "diagnostics":
        return {**base, "results": [], "warnings": ["AST parsing found no syntax errors; this does not check types or runtime behavior."], "truncated": False}
    line = int(payload["line"])
    column = int(payload["column"])
    if line < 1 or line > len(lines) or column < 1:
        raise ValueError("Line or column is outside the file.")
    token = next((match.group() for match in re.finditer(r"[^\W\d]\w*", lines[line - 1], re.UNICODE)
                  if match.start() < column <= match.end()), None)
    if not token:
        raise ValueError("Point line and column at a Python identifier.")
    indexed, truncated = scan(root, file)
    selected = next((item for item in indexed if item.file == file), None)
    if not selected:
        raise ValueError("This Python file could not be indexed within the project limit.")
    imported_modules = {entry["module"] for entry in selected.imports if token in entry["names"]}
    definitions = [entry for item in indexed for entry in item.definitions if entry["name"] == token]
    definitions.sort(key=lambda entry: (entry["file"] != file,
                                        module_name(root, entry["file"]) not in imported_modules,
                                        entry["line"]))
    references = [entry for item in indexed for entry in item.references if entry["name"] == token]
    callers = [entry for item in indexed for entry in item.callers if entry["name"] == token]
    selected_module = selected.module
    importers = [entry for item in indexed for entry in item.imports
                 if entry["module"] == selected_module or entry["module"].startswith(selected_module + ".")]
    counts = {}
    for entry in references + importers:
        counts[entry["file"]] = counts.get(entry["file"], 0) + 1
    impact = {"definitions": definitions[:20], "references": references[:80], "callers": callers[:40],
              "imports": importers[:40],
              "affectedFiles": [{"file": path, "references": count} for path, count in
                                sorted(counts.items(), key=lambda pair: -pair[1])[:40]],
              "omittedResults": max(0, len(references) - 80), "truncated": truncated or len(references) > 80}
    if action == "impact":
        return {**base, "query": {"line": line, "column": column, "symbol": token}, **impact}
    matches = definitions if action == "definition" else references
    return {**base, "query": {"line": line, "column": column, "symbol": token},
            "results": matches[:80], "omittedResults": max(0, len(matches) - 80),
            "truncated": truncated or len(matches) > 80}


try:
    print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
except Exception as error:
    print(json.dumps({"error": str(error)[:500]}))
