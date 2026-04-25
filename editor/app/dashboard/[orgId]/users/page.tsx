"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, QrCode, MoreHorizontal, Phone, Bot, Wifi, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { showToast } from "@/components/ui/Toast";
import { users, config as pbxConfig, type PbxUser } from "@/lib/pbx/client";
import { SipQrDialog } from "@/components/users/SipQrDialog";
import { PasswordInput } from "@/components/ui/password-input";

export default function UsersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [qrUser, setQrUser] = useState<PbxUser | null>(null);
  const [editUser, setEditUser] = useState<PbxUser | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "", email: "", extension: "", password: "",
    role: "agent" as PbxUser["role"],
    routing_type: "sip" as "sip" | "ai_agent",
    routing_destination: "", phone_number: "",
    ring_target: "ext" as "ext" | "phone",
  });

  function openEdit(user: PbxUser) {
    setEditUser(user);
    setEditForm({
      full_name: user.full_name || "", email: user.email || "", extension: user.extension || "",
      password: "", role: user.role || "agent",
      routing_type: user.routing_type || "sip",
      routing_destination: user.routing_destination || "",
      phone_number: user.phone_number || "",
      ring_target: user.ring_target || "ext",
    });
  }

  async function handleEdit() {
    if (!editUser) return;
    try {
      await users.update(editUser.id, {
        full_name: editForm.full_name, email: editForm.email, extension: editForm.extension,
        role: editForm.role,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      await users.updateRouting(editUser.id, {
        routing_type: editForm.routing_type,
        routing_destination: editForm.routing_destination || undefined,
        ring_target: editForm.ring_target,
        phone_number: editForm.phone_number || undefined,
      });
      showToast("User updated — deploying config...", "success");
      setEditUser(null);
      try { await pbxConfig.deploy(); await pbxConfig.reload(); showToast("Config deployed", "success"); } catch { showToast("Updated but deploy failed", "error"); }
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update", "error");
    }
  }

  const [form, setForm] = useState({
    username: "", email: "", extension: "", full_name: "", password: "",
    role: "agent" as PbxUser["role"],
    routing_type: "sip" as "sip" | "ai_agent",
    routing_destination: "", phone_number: "",
    ring_target: "ext" as "ext" | "phone",
  });

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      setUserList(await users.list());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    try {
      await users.create({
        username: form.username, email: form.email, extension: form.extension,
        full_name: form.full_name, password: form.password, role: form.role,
        routing_type: form.routing_type,
        routing_destination: form.routing_destination || undefined,
        phone_number: form.phone_number || undefined,
        ring_target: form.ring_target,
      });
      showToast("User created — deploying config...", "success");
      setCreateOpen(false);
      setForm({ username: "", email: "", extension: "", full_name: "", password: "", role: "agent", routing_type: "sip", routing_destination: "", phone_number: "", ring_target: "ext" });
      // Auto-deploy Asterisk config so the new extension is immediately usable
      try {
        await pbxConfig.deploy();
        await pbxConfig.reload();
        showToast("Config deployed — extension ready", "success");
      } catch {
        showToast("User created but config deploy failed — deploy manually in Settings", "error");
      }
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create user", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this user?")) return;
    try {
      await users.delete(id);
      showToast("User deleted", "success");
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete", "error");
    }
  }

  const routingIcon = (u: PbxUser) => u.routing_type === "ai_agent" ? <Bot className="h-3.5 w-3.5" /> : u.ring_target === "phone" ? <Phone className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />;
  const routingLabel = (u: PbxUser) => u.routing_type === "ai_agent" ? "AI Bot" : u.ring_target === "phone" ? "Phone" : "SIP";

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users & Extensions</h1>
          <p className="text-sm text-muted-foreground">Manage SIP users, extensions, and call routing</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add User</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create User</DialogTitle>
              <DialogDescription>Add a new extension to the organization</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Full Name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="John Doe" /></div>
                <div className="space-y-1.5"><Label>Extension</Label><Input value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} placeholder="1001" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="johndoe" /></div>
                <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Password</Label><PasswordInput autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 chars" /></div>
                <div className="space-y-1.5"><Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as PbxUser["role"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-1.5"><Label>Call Routing</Label>
                <Select value={form.routing_type === "ai_agent" ? "ai_agent" : form.ring_target === "phone" ? "phone" : "sip"} onValueChange={(v) => {
                  if (v === "ai_agent") setForm({ ...form, routing_type: "ai_agent", ring_target: "ext" });
                  else if (v === "phone") setForm({ ...form, routing_type: "sip", ring_target: "phone" });
                  else setForm({ ...form, routing_type: "sip", ring_target: "ext" });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sip">SIP / IP Phone</SelectItem>
                    <SelectItem value="ai_agent">AI Bot (WSS URL)</SelectItem>
                    <SelectItem value="phone">Phone Call (Mobile)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.routing_type === "ai_agent" && (
                <div className="space-y-1.5"><Label>WebSocket URL</Label><Input value={form.routing_destination} onChange={(e) => setForm({ ...form, routing_destination: e.target.value })} placeholder="ws://localhost:7860/ws/{org}/{bot}?key=..." className="font-mono text-xs" /></div>
              )}
              {form.ring_target === "phone" && form.routing_type !== "ai_agent" && (
                <div className="space-y-1.5"><Label>Phone Number</Label><Input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} placeholder="+919876543210" /></div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Ext</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton cols={7} />
            ) : userList.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No users yet</TableCell></TableRow>
            ) : userList.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-mono text-sm">{user.extension}</TableCell>
                <TableCell className="font-medium">{user.full_name || user.username}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs capitalize">{user.role}</Badge></TableCell>
                <TableCell><div className="flex items-center gap-1.5 text-sm text-muted-foreground">{routingIcon(user)}{routingLabel(user)}</div></TableCell>
                <TableCell><Badge variant={user.status === "active" ? "default" : "secondary"} className="text-xs">{user.status}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(user)}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQrUser(user)}><QrCode className="h-4 w-4 mr-2" />SIP QR Code</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {qrUser && <SipQrDialog user={qrUser} onClose={() => setQrUser(null)} />}

      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.extension}</DialogTitle>
            <DialogDescription>Update user settings and call routing</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Full Name</Label><Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Extension</Label><Input value={editForm.extension} onChange={(e) => setEditForm({ ...editForm, extension: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Role</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v as PbxUser["role"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>New Password (leave blank to keep)</Label><PasswordInput autoComplete="off" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="Leave blank to keep current" /></div>
            <Separator />
            <div className="space-y-1.5"><Label>Call Routing</Label>
              <Select value={editForm.routing_type === "ai_agent" ? "ai_agent" : editForm.ring_target === "phone" ? "phone" : "sip"} onValueChange={(v) => {
                if (v === "ai_agent") setEditForm({ ...editForm, routing_type: "ai_agent", ring_target: "ext" });
                else if (v === "phone") setEditForm({ ...editForm, routing_type: "sip", ring_target: "phone" });
                else setEditForm({ ...editForm, routing_type: "sip", ring_target: "ext" });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sip">SIP / IP Phone</SelectItem>
                  <SelectItem value="ai_agent">AI Bot (WSS URL)</SelectItem>
                  <SelectItem value="phone">Phone Call (Mobile)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.routing_type === "ai_agent" && (
              <div className="space-y-1.5"><Label>WebSocket URL</Label><Input value={editForm.routing_destination} onChange={(e) => setEditForm({ ...editForm, routing_destination: e.target.value })} placeholder="ws://localhost:7860/ws/{org}/{bot}" className="font-mono text-xs" /></div>
            )}
            {editForm.ring_target === "phone" && editForm.routing_type !== "ai_agent" && (
              <div className="space-y-1.5"><Label>Phone Number</Label><Input value={editForm.phone_number} onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })} placeholder="+919876543210" /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
