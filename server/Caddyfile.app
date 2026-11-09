w.dark20.xyz {
  encode gzip
  reverse_proxy rate-monitor-app:8787
}
