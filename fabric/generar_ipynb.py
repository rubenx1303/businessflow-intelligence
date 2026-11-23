"""Convierte los notebooks en formato .py (celdas separadas por '# %%') a .ipynb para importarlos en Fabric.
El .py es la fuente versionada (los diffs son legibles); el .ipynb se genera.   Uso: python fabric/generar_ipynb.py"""
import json
import re
from pathlib import Path

DIR = Path(__file__).resolve().parent / "notebooks"

for py in sorted(DIR.glob("*.py")):
    celdas = []
    for bloque in re.split(r"^# %%", py.read_text(encoding="utf-8"), flags=re.M)[1:]:
        cabecera, _, cuerpo = bloque.partition("\n")
        cuerpo = cuerpo.strip("\n")
        if "[markdown]" in cabecera:
            texto = "\n".join(re.sub(r"^# ?", "", l) for l in cuerpo.splitlines())
            celdas.append({"cell_type": "markdown", "metadata": {}, "source": texto.splitlines(keepends=True)})
        else:
            celdas.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": cuerpo.splitlines(keepends=True)})
    nb = {
        "cells": celdas, "nbformat": 4, "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"name": "synapse_pyspark", "display_name": "Synapse PySpark"},
            "language_info": {"name": "python"},
            "kernel_info": {"name": "synapse_pyspark"},
        },
    }
    destino = py.with_suffix(".ipynb")
    destino.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{py.name} → {destino.name} ({len(celdas)} celdas)")
