package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Container-ID", os.Getenv("CLOUDFLARE_DEPLOYMENT_ID"))
	w.Header().Set("X-Container-Country", os.Getenv("CLOUDFLARE_COUNTRY_A2"))
	w.Header().Set("X-Container-Location", os.Getenv("CLOUDFLARE_LOCATION"))
	w.Header().Set("X-Container-Region", os.Getenv("CLOUDFLARE_REGION"))

	content, err := os.ReadFile("index.txt")
	if err != nil {
		// If file doesn't exist or can't be read, show default message
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "No Content")
		return
	}

	// Set content type header
	w.Header().Set("Content-Type", "text/plain")

	// Write the file content to the response
	w.Write(content)
}

func adminUpdateHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request body", http.StatusInternalServerError)
		return
	}

	err = os.WriteFile("index.txt", body, 0644)
	if err != nil {
		http.Error(w, "Error writing to file", http.StatusInternalServerError)
		return
	}

	fmt.Fprintf(w, "Content successfully updated")
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", handler)
	mux.HandleFunc("POST /admin/update-text", adminUpdateHandler)

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		if err := server.Close(); err != nil {
			log.Fatalf("HTTP close error: %v", err)
		}
	}()

	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("HTTP server error: %v", err)
	}
}
