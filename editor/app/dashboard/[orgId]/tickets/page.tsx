"use client";

import { Ticket } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TicketsPage() {
  return (
    <div className="p-3 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">Track and manage support tickets</p>
      </div>
      <Card className="max-w-lg mx-auto mt-16">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Ticket className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>
            The ticket system requires the Ticket API to be configured on your AstraPBX server.
            This feature will be available once the API-backed ticket endpoints are integrated.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-xs text-muted-foreground">
            Tickets will support creation, status updates, filtering, and archiving via the REST API.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
