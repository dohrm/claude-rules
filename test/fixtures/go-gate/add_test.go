package gateprobe

import "testing"

func TestAddOne(t *testing.T) {
	if got := AddOne(1); got != 2 {
		t.Fatalf("AddOne(1) = %d", got)
	}
}
