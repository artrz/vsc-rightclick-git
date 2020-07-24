import * as vscode from "vscode"
import * as child_process from "child_process"
import { GitExtension } from "./types/git"

export const outputChannel = vscode.window.createOutputChannel("Rightclick Git")

export const getGit = () =>
  vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports?.getAPI(1)

const execProcess = async (
  cmd: string[],
  options: child_process.ExecOptions,
): Promise<child_process.ChildProcess> => {
  return new Promise((resolve, reject) => {
    const p = child_process.exec(cmd.join(" "), options)

    p.addListener("error", () => {
      reject(p)
    })
    p.addListener("exit", (code) => {
      if (code == 0) {
        resolve(p)
      } else {
        reject(p)
      }
    })
    p.addListener("close", (code) => {
      if (code == 0) {
        resolve(p)
      } else {
        reject(p)
      }
    })
  })
}

type RunGitResults = {
  affectedFiles: vscode.Uri[]
  missingRepo: vscode.Uri[]
  outOfWorkspace: vscode.Uri[]
  /**
   * Not actually on the filesystem??!
   * (non file scheme)
   */
  notOnThisEarth: vscode.Uri[]
  /**
   * the particular commands that resulted in
   */
  gitProcesses: child_process.ChildProcess[]
  /**
   * Non 0 length was "something is up"
   */
  gitfailedProcesses: child_process.ChildProcess[]
}

/**
 * Runs a series of git commands to execute `commands` safely handling and batching
 * based on where the file is (local mutli-workspace stuff), cd'ing into the repository's
 * root before going to commit the files.
 * @param commands The various things like switches and commands that suffix git (-s add)
 * @param files The list of uris to operate on
 */
export const runGit = async (
  commands: string[],
  files: vscode.Uri[],
): Promise<RunGitResults> => {
  const git = getGit()
  if (!git) {
    throw new Error("Could not get the git api")
  }

  const info: RunGitResults = {
    missingRepo: [],
    outOfWorkspace: [],
    notOnThisEarth: [],
    affectedFiles: [],
    gitProcesses: [],
    gitfailedProcesses: [],
  }

  /**
   * Working directory: files in that working directory.
   * Seperated by repo.
   */
  const batches: Record<string, vscode.Uri[]> = {}

  for (const file of files) {
    const repoOfFile = git.getRepository(file)
    if (!repoOfFile) {
      info.missingRepo.push(file)
      continue
    }

    const workspaceOfFile = vscode.workspace.getWorkspaceFolder(file)
    if (!workspaceOfFile) {
      info.missingRepo.push(file)
      continue
    }

    // Could be ftp or some nonsense
    if (workspaceOfFile.uri.scheme != "file") {
      info.notOnThisEarth.push(file)
      continue
    }

    const repoRoot = repoOfFile.rootUri.fsPath
    if (!batches[repoRoot]) {
      batches[repoRoot] = []
    }
    batches[repoRoot].push(file)
  }

  const cmd: string[] = [`"${git.git.path}"`, ...commands]

  try {
    const results = await Promise.all(
      Object.entries(batches).map(([cwd, toMutate]) =>
        execProcess([...cmd, ...toMutate.map((file) => `"${file.fsPath}"`)], {
          cwd,
          windowsHide: true,
          env: process.env,
        }),
      ),
    )
    info.gitProcesses.push(...results.filter((p) => p.exitCode == 0))
    info.gitfailedProcesses.push(...results.filter((p) => p.exitCode != 0))
  } catch (error) {
    if (typeof error == "object") {
      if (error?.pid) {
        info.gitfailedProcesses.push(error)
      } else {
        throw error
      }
    } else {
      throw error
    }
  }
  return info
}