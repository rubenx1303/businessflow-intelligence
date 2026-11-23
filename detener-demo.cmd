@echo off
rem Detiene la base de datos de la demo. Los datos se conservan en un volumen de Docker.
rem La API y la web se paran cerrando sus dos ventanas de PowerShell.
cd /d "%~dp0"
docker compose stop
echo.
echo Base de datos detenida. Para borrar tambien los datos: docker compose down -v
pause
