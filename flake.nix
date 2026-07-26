{
  description = "Development environment with Node.js and Bun";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {inherit system;};
      in {
        devShells.default = pkgs.mkShell {
          name = "node-bun-devshell";

          packages = [
            pkgs.nodejs
            pkgs.bun
          ];

          shellHook = ''
            echo "Node.js version: $(node --version)"
            echo "Bun version: $(bun --version)"
            echo "Dev environment ready!"
          '';
        };
      }
    );
}
