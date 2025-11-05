{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.npm
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.redis
    pkgs.openssl
    pkgs.pkg-config
    pkgs.gcc
    pkgs.gnumake
    pkgs.git
  ];
}
