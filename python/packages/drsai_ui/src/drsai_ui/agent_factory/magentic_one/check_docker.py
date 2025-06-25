from ...ui_backend.backend.cli import (
    check_docker_running,
    check_browser_image,
    check_python_image,
    build_browser_image,
    build_python_image)
import typer
from typing import Optional

def check_docker(rebuild_docker: Optional[bool] = False,):
    typer.echo("Checking if Docker is running...", nl=False)

    # Set things up for Docker
    typer.echo("Checking if Docker is running...", nl=False)

    if not check_docker_running():
        typer.echo(typer.style("Failed\n", fg=typer.colors.RED, bold=True))
        typer.echo("Docker is not running. Please start Docker and try again.")
        raise typer.Exit(1)
    else:
        typer.echo(typer.style("OK", fg=typer.colors.GREEN, bold=True))

    typer.echo("Checking Docker vnc browser image...", nl=False)
    if not check_browser_image() or rebuild_docker:
        typer.echo(typer.style("Update\n", fg=typer.colors.YELLOW, bold=True))
        typer.echo("Building Docker vnc image (this WILL take a few minutes)")
        build_browser_image()
        typer.echo("\n")
    else:
        typer.echo(typer.style("OK", fg=typer.colors.GREEN, bold=True))

    typer.echo("Checking Docker python image...", nl=False)
    if not check_python_image() or rebuild_docker:
        typer.echo(typer.style("Update\n", fg=typer.colors.YELLOW, bold=True))
        typer.echo("Building Docker python image (this WILL take a few minutes)")
        build_python_image()
        typer.echo("\n")
    else:
        typer.echo(typer.style("OK", fg=typer.colors.GREEN, bold=True))

    # check the images again and throw an error if they are not found
    if not check_browser_image() or not check_python_image():
        typer.echo(typer.style("Failed\n", fg=typer.colors.RED, bold=True))
        typer.echo("Docker images not found. Please build the images and try again.")
        raise typer.Exit(1)

